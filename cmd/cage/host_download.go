package main

import (
	"context"
	"errors"
	"io"

	"github.com/sylvinus/agent-vm/internal/hostproxy"
)

// Private subprocess entry for host installers. Proxy settings are resolved in
// Go for every HTTPS request, including redirects and PAC host rules.
func hostDownload(ctx context.Context, args []string, out io.Writer) error {
	if len(args) != 3 && len(args) != 4 {
		return errors.New("host-download requires URL, staging path, component name and optional Accept value")
	}
	accept := ""
	if len(args) == 4 {
		accept = args[3]
	}
	return hostproxy.Download(ctx, args[0], args[1], args[2], accept, out)
}
