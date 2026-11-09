package workbench

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestWindowsBrowserRelayHelper(t *testing.T) {
	if os.Getenv("CAGE_BROWSER_RELAY_FIXTURE") != "1" {
		return
	}
	var uploaded []byte
	direction := ""
	const transfer = "0123456789abcdef0123456789abcdef"
	read := bufio.NewScanner(os.Stdin)
	read.Buffer(make([]byte, 65536), 128<<10)
	for read.Scan() {
		var request struct {
			Path  string `json:"path"`
			Input struct {
				Direction string `json:"direction"`
				Data      string `json:"data"`
				Sequence  int    `json:"sequence"`
				After     uint64 `json:"after"`
			} `json:"input"`
		}
		if json.Unmarshal(read.Bytes(), &request) != nil {
			os.Exit(2)
		}
		var result any = map[string]any{"ok": true}
		switch request.Path {
		case "/frame":
			time.Sleep(time.Hour)
		case "/tabs":
			result = map[string]any{"active": "tab", "tabs": []any{}}
		case "/events":
			result = map[string]any{"sequence": 2, "events": []any{}}
			if request.Input.After < 2 {
				result = map[string]any{"sequence": 2, "state": map[string]any{"active": "tab", "tabs": []any{}}, "events": []any{
					map[string]any{"sequence": 2, "type": "clipboard", "value": map[string]any{"id": "tab", "text": "复制🙂", "context": "0123456789abcdef0123456789abcdef", "document": "current-document"}},
				}}
			}
		case "/phone-browser/frame":
			result = map[string]any{"error": "fixture public-only denial", "code": "phone_browser_error", "status": 403}
		case "/file-open":
			direction = request.Input.Direction
			if request.Input.Direction == "upload" || request.Input.Direction == "extension" {
				uploaded = nil
				result = map[string]any{"transfer": transfer}
			}
			if request.Input.Direction == "download" {
				result = map[string]any{"transfer": transfer, "size": 131089, "name": "binary.bin"}
			}
		case "/file-chunk":
			chunk, err := base64.StdEncoding.DecodeString(request.Input.Data)
			if err != nil || len(chunk) > 65536 {
				os.Exit(3)
			}
			uploaded = append(uploaded, chunk...)
			result = map[string]any{"ack": request.Input.Sequence + 1}
		case "/file-finish":
			if direction == "extension" {
				result = map[string]any{"session": "bf19a220-9ba0-4e69-a519-e23ad6bf0d71", "name": "Fixture extension", "version": "1.0", "permissions": []string{"storage"}, "hostPermissions": []string{}, "size": len(uploaded)}
			} else {
				result = map[string]any{"ok": bytes.Equal(uploaded, bytes.Repeat([]byte{0xab}, 131089)), "size": len(uploaded), "name": "binary.bin"}
			}
		case "/vault":
			result = map[string]any{"available": true, "origin": "https://mail.example.com", "document": "fixture-document", "candidates": []any{}, "entries": []any{}}
		case "/image-start", "/paste-start":
			uploaded = nil
			result = map[string]any{"transfer": transfer}
		case "/image-chunk", "/paste-chunk":
			chunk, err := base64.StdEncoding.DecodeString(request.Input.Data)
			if err != nil || len(chunk) > 65536 {
				os.Exit(3)
			}
			uploaded = append(uploaded, chunk...)
			result = map[string]any{"ack": request.Input.Sequence + 1}
		case "/image-finish", "/paste-finish":
			result = map[string]any{"ok": true, "size": len(uploaded), "clipboard": map[string]any{"revision": 1, "available": true}}
		case "/file-read":
			start := request.Input.Sequence * 65536
			remaining := 131089 - start
			if remaining > 65536 {
				remaining = 65536
			}
			result = map[string]any{"data": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xab}, remaining)), "sequence": request.Input.Sequence + 1, "eof": start+remaining == 131089}
		}
		data, _ := json.Marshal(result)
		_, _ = os.Stdout.Write(append(data, '\n'))
	}
	os.Exit(0)
}

func fixtureWindowsBrowserClient(t *testing.T) *windowsBrowserClient {
	client := newWindowsBrowserClient(context.Background(), "unused-test-profile")
	client.start = func(ctx context.Context) (*exec.Cmd, error) {
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestWindowsBrowserRelayHelper$")
		cmd.Env = append(os.Environ(), "CAGE_BROWSER_RELAY_FIXTURE=1")
		return cmd, nil
	}
	t.Cleanup(client.close)
	return client
}

func TestWindowsBrowserRouteRejectsPathAndCredentialInjection(t *testing.T) {
	for _, path := range []string{"http://private.invalid/tabs", "/tabs?token=secret", "/../private", "/file-open/secret", "tabs"} {
		if validWindowsBrowserRoute("POST", path) {
			t.Fatalf("accepted route %q", path)
		}
	}
	if validWindowsBrowserRoute("GET", "/file-open") {
		t.Fatal("accepted file mutation using GET")
	}
	client := fixtureWindowsBrowserClient(t)
	if _, err := client.request(context.Background(), "POST", "/tabs?secret", nil); err == nil {
		t.Fatal("invalid route reached transport")
	}
}

func TestWindowsBrowserChunkedUploadAndDownloadPreserveBinaryBytes(t *testing.T) {
	client := fixtureWindowsBrowserClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	payload := bytes.Repeat([]byte{0xab}, 131089)
	data, err := client.upload(ctx, "bf19a220-9ba0-4e69-a519-e23ad6bf0d71", "binary.bin", bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatal(err)
	}
	var receipt struct {
		OK   bool `json:"ok"`
		Size int  `json:"size"`
	}
	if json.Unmarshal(data, &receipt) != nil || !receipt.OK || receipt.Size != len(payload) {
		t.Fatal("upload was not confirmed")
	}
	stream, size, name, err := client.download(ctx, "bf19a220-9ba0-4e69-a519-e23ad6bf0d71")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	got, err := io.ReadAll(stream)
	if err != nil || size != int64(len(payload)) || name != "binary.bin" || !bytes.Equal(got, payload) {
		t.Fatalf("download mismatch: size=%d err=%v", len(got), err)
	}
}

func TestWindowsBrowserCanceledFrameCannotBecomeNextViewerReply(t *testing.T) {
	client := fixtureWindowsBrowserClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := client.request(ctx, "GET", "/frame", nil); err != context.DeadlineExceeded {
		t.Fatalf("wanted cancellation, got %v", err)
	}
	ctx, cancelNext := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelNext()
	data, err := client.request(ctx, "GET", "/tabs", nil)
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		Active string `json:"active"`
	}
	if json.Unmarshal(data, &state) != nil || state.Active != "tab" {
		t.Fatal("stale frame replaced new tab response")
	}
}

func TestNativeBrowserEventsPreserveCopyContextAndSequence(t *testing.T) {
	client := fixtureWindowsBrowserClient(t)
	server := &Server{windowsBrowserControl: client}
	ctx, cancel := context.WithTimeout(t.Context(), 650*time.Millisecond)
	defer cancel()
	stream := server.subscribeNativeBrowser(ctx)
	defer stream.Close()
	data, err := io.ReadAll(stream)
	if err != nil {
		t.Fatal(err)
	}
	wanted := "id: 2\nevent: clipboard\ndata: "
	if bytes.Count(data, []byte(wanted)) != 1 {
		t.Fatalf("copy event was lost or replayed: %s", data)
	}
	for _, value := range []string{"复制🙂", "0123456789abcdef0123456789abcdef", "current-document"} {
		if !bytes.Contains(data, []byte(value)) {
			t.Fatalf("copy event lost %q", value)
		}
	}
}
