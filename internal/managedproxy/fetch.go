package managedproxy

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/miekg/dns"
)

// BootstrapClient is for explicit infrastructure downloads only. It ignores
// environment proxies and resolves public hosts over an IP-addressed DoH URL.
func BootstrapClient() *http.Client {
	tr := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ip, err := netip.ParseAddr(host)
		if err != nil {
			ip, err = resolveInfrastructure(ctx, host)
			if err != nil {
				return nil, err
			}
		}
		if !publicIP(ip) {
			return nil, errors.New("订阅服务器必须使用公网地址")
		}
		return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
	}, IdleConnTimeout: 10 * time.Second}
	return &http.Client{Transport: tr, Timeout: 30 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) >= 3 || r.URL.Scheme != "https" || r.URL.User != nil {
			return errors.New("订阅重定向被拒绝")
		}
		return nil
	}}
}
func usageSummary(raw string) string {
	parts := []string{}
	for _, field := range strings.Split(raw, ";") {
		kv := strings.SplitN(strings.TrimSpace(field), "=", 2)
		if len(kv) != 2 {
			continue
		}
		if kv[0] != "upload" && kv[0] != "download" && kv[0] != "total" && kv[0] != "expire" {
			continue
		}
		if _, err := strconv.ParseUint(kv[1], 10, 64); err == nil {
			parts = append(parts, kv[0]+"="+kv[1])
		}
	}
	return strings.Join(parts, "; ")
}
func publicIP(ip netip.Addr) bool {
	return ip.Is4() && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !netip.MustParsePrefix("100.64.0.0/10").Contains(ip) && !netip.MustParsePrefix("198.18.0.0/15").Contains(ip)
}
func resolveInfrastructure(ctx context.Context, host string) (netip.Addr, error) {
	q := new(dns.Msg)
	q.SetQuestion(dns.Fqdn(host), dns.TypeA)
	b, _ := q.Pack()
	tr := &http.Transport{Proxy: nil}
	defer tr.CloseIdleConnections()
	c := &http.Client{Transport: tr, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("DNS redirect refused") }}
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://1.1.1.1/dns-query", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/dns-message")
	req.Header.Set("Accept", "application/dns-message")
	resp, err := c.Do(req)
	if err != nil {
		return netip.Addr{}, errors.New("代理基础设施域名解析失败")
	}
	defer resp.Body.Close()
	wire, err := io.ReadAll(io.LimitReader(resp.Body, 65536))
	var answer dns.Msg
	if err != nil || resp.StatusCode != 200 || answer.Unpack(wire) != nil || answer.Id != q.Id {
		return netip.Addr{}, errors.New("代理基础设施 DNS 响应无效")
	}
	for _, rr := range answer.Answer {
		if a, ok := rr.(*dns.A); ok {
			if ip, ok := netip.AddrFromSlice(a.A); ok && publicIP(ip.Unmap()) {
				return ip.Unmap(), nil
			}
		}
	}
	return netip.Addr{}, errors.New("代理基础设施域名没有可用公网 IPv4")
}
func Fetch(ctx context.Context, client *http.Client, rawURL string) ([]byte, string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return nil, "", errors.New("订阅需要完整的 HTTPS 网址，不支持地址内用户名和密码")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return nil, "", errors.New("订阅网址无效")
	}
	req.Header.Set("User-Agent", "clash.meta/Cage")
	res, err := client.Do(req)
	if err != nil {
		return nil, "", errors.New("订阅下载失败，请检查下载路径和服务地址")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, "", errors.New("订阅服务器返回 HTTP " + strconv.Itoa(res.StatusCode))
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, MaxImport+1))
	if err != nil || len(b) > MaxImport {
		return nil, "", errors.New("订阅下载中断或超过 8 MiB")
	}
	usage := "" // Keep only known numeric metadata; never echo arbitrary headers.
	if raw := res.Header.Get("Subscription-Userinfo"); len(raw) < 300 {
		usage = usageSummary(raw)
	}
	return b, usage, nil
}
