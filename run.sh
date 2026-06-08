#!/bin/bash
set -e

# Detect OS and architecture
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

# Setup local paths
export PATH="$PWD/.go_sdk/go/bin:$PATH"
export GOPATH="$PWD/.gopath"
export PATH="$GOPATH/bin:$PATH"

# Auto setup helper
check_setup() {
    if [ ! -d ".go_sdk/go" ] || [ ! -f ".gopath/bin/wails3" ]; then
        echo "=========================================="
        echo "Installing portable Go and Wails v3..."
        echo "=========================================="
        mkdir -p .go_sdk
        if [ "$ARCH" = "arm64" ]; then
            GO_URL="https://go.dev/dl/go1.22.5.darwin-arm64.tar.gz"
        else
            GO_URL="https://go.dev/dl/go1.22.5.darwin-amd64.tar.gz"
        fi
        echo "Downloading Go SDK from $GO_URL..."
        curl -L "$GO_URL" -o go_sdk.tar.gz
        tar -xzf go_sdk.tar.gz -C .go_sdk
        rm go_sdk.tar.gz
        
        # Install Wails v3
        echo "Installing portable Wails v3 CLI..."
        go install github.com/wailsapp/wails/v3/cmd/wails3@latest
        rm -f .gopath/bin/wails
        ln -sf wails3 .gopath/bin/wails
        
        # Install frontend deps
        echo "Installing frontend dependencies..."
        if command -v bun &> /dev/null; then
            bun install --cwd frontend
        else
            npm install --prefix frontend
        fi
        echo "Setup complete!"
    fi
}

check_setup

# Show interactive menu or run option
ACTION=$1
if [ -z "$ACTION" ]; then
    echo "=========================================="
    echo "   NoCodex ePDF Studio - Portable Run"
    echo "=========================================="
    echo "1) Start Development Mode (wails dev)"
    echo "2) Build Standalone macOS App"
    echo "3) Build Standalone Windows (.exe) App"
    echo "4) Re-run Setup / Update Dependencies"
    echo "=========================================="
    read -p "Select an option (1-4): " CHOICE
    case $CHOICE in
        1) ACTION="dev" ;;
        2) ACTION="build-mac" ;;
        3) ACTION="build-win" ;;
        4) ACTION="setup" ;;
        *) echo "Invalid choice"; exit 1 ;;
    esac
fi

case $ACTION in
    dev)
        wails dev
        ;;
    build-mac)
        wails task darwin:package
        ;;
    build-win)
        wails task windows:build
        ;;
    setup)
        # Force reinstall
        rm -rf .go_sdk .gopath
        check_setup
        ;;
    *)
        echo "Unknown command: $ACTION"
        exit 1
        ;;
esac
