#!/bin/bash
# Gemini CLI Architecture Q&A Assistant
# Simple wrapper script for the Node.js Q&A tool

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if GEMINI_API_KEY is set
if [ -z "$GEMINI_API_KEY" ]; then
    echo -e "${RED}Error: GEMINI_API_KEY environment variable is not set${NC}"
    echo ""
    echo "Please set your API key:"
    echo "  export GEMINI_API_KEY=\"your-api-key-here\""
    echo ""
    echo "You can get an API key from: https://aistudio.google.com/apikey"
    echo ""
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js 18 or later"
    exit 1
fi

# Run the Q&A assistant
cd "$SCRIPT_DIR"
node qa-assistant.mjs "$@"
