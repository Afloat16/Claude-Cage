#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6,<7"]
# ///
"""Copy one cached Clash group member and its dialer chain into a private profile.

No subscription is fetched and the active Clash configuration is never changed.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import socket
import yaml


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--group", required=True)
    parser.add_argument("--index", type=int, default=0)
    parser.add_argument("--profile", type=Path, default=Path.home() / ".claude-cage")
    parser.add_argument("--port", type=int, default=17896)
    parser.add_argument("--core", type=Path, default=Path("/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo"))
    args = parser.parse_args()
    config = yaml.safe_load(args.source.read_text())
    nodes = {p["name"]: copy.deepcopy(p) for p in config.get("proxies", [])}
    providers = {}
    for name, provider in config.get("proxy-providers", {}).items():
        path = args.source.parent / provider["path"]
        loaded = yaml.safe_load(path.read_text()).get("proxies", [])
        providers[name] = []
        override = provider.get("override", {})
        for node in loaded:
            node = copy.deepcopy(node)
            node.update({k: v for k, v in override.items() if k not in ("additional-prefix", "additional-suffix")})
            node["name"] = override.get("additional-prefix", "") + node["name"] + override.get("additional-suffix", "")
            nodes[node["name"]] = node
            providers[name].append(node["name"])
    groups = {g["name"]: g for g in config.get("proxy-groups", [])}

    def choices(name):
        g = groups[name]
        return g.get("proxies", []) + [n for p in g.get("use", []) for n in providers[p]]

    selected = choices(args.group)[args.index]
    result = {}
    resolving = set()

    def resolve(name):
        if name in resolving:
            raise ValueError("cyclic proxy chain")
        resolving.add(name)
        try:
            if name in groups:
                return resolve(choices(name)[0])
            if name in ("DIRECT", "REJECT", "PASS") or name not in nodes:
                raise ValueError("the selected chain must terminate in an explicit proxy node")
            if name in result:
                return name
            node = copy.deepcopy(nodes[name])
            if node.get("dialer-proxy"):
                node["dialer-proxy"] = resolve(node["dialer-proxy"])
            # Pin infrastructure endpoints during import. Keep the original TLS
            # name when the server field is a hostname, avoiding runtime host DNS.
            server = node.get("server")
            if server:
                try:
                    socket.inet_pton(socket.AF_INET, server)
                except OSError:
                    try:
                        socket.inet_pton(socket.AF_INET6, server)
                    except OSError:
                        node.setdefault("servername", server)
                        node["server"] = socket.getaddrinfo(server, node["port"], socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
            result[name] = node
            return name
        finally:
            resolving.remove(name)

    endpoint = resolve(selected)
    os.umask(0o077)
    args.profile.mkdir(mode=0o700, parents=True, exist_ok=True)
    proxy_dir = args.profile / "proxy"
    proxy_dir.mkdir(mode=0o700, exist_ok=True)
    output = {"mixed-port": args.port, "bind-address": "127.0.0.1", "allow-lan": False,
              "mode": "rule", "log-level": "warning", "ipv6": False,
              "tun": {"enable": False}, "dns": {"enable": False},
              "proxies": list(result.values()), "rules": ["MATCH," + endpoint]}
    target = proxy_dir / "config.yaml"
    target.write_text(yaml.safe_dump(output, allow_unicode=True, sort_keys=False))
    target.chmod(0o600)
    (proxy_dir / "runner.json").write_text(json.dumps({"executable": str(args.core.resolve())}) + "\n")
    cage_config = args.profile / "config.json"
    if cage_config.exists():
        c = json.loads(cage_config.read_text())
    else:
        c = {"dns_url": "https://1.1.1.1/dns-query", "timezone": "Etc/UTC", "locale": "en_US.UTF-8", "browser_language": "en-US"}
    c["proxy_url"] = f"socks5://127.0.0.1:{args.port}"
    cage_config.write_text(json.dumps(c, indent=2) + "\n")
    cage_config.chmod(0o600)
    print(f"Imported group member {args.index + 1}; {len(result)} fixed proxy hop(s).")
    print(f"Private profile: {args.profile}")


if __name__ == "__main__":
    main()
