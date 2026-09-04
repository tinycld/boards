module tinycld.org/packages/boards

go 1.26.3

// `go mod tidy` does NOT work in this workspace: it resolves the module graph
// before applying go.work's replace, so the `tinycld.org/core v0.0.0` pin below
// hits the proxy and fails with "unrecognized import path". Every member's
// require block is therefore maintained by hand — add a line when a new import
// appears, and let `go build ./...` name what is missing.
//
// There is deliberately NO go.sum beside this file, unlike calendar/ and drive/
// which commit one. Boards imports nothing outside these three modules, and all
// three resolve through go.work replaces to local directories — core and the
// vendored PocketBase fork by replace, dbx transitively through the fork. So
// there are no module hashes to record; what little there is lands in the
// gitignored go.work.sum, which `go mod download` regenerates. Verified by
// deleting it and running the CI sequence from clean.
require (
	github.com/pocketbase/dbx v1.12.0
	github.com/pocketbase/pocketbase v0.39.8
	roci.dev/fracdex v0.0.0-20241211175510-82d7df79e312
	tinycld.org/core v0.0.0
)
