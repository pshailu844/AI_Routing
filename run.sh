#!/bin/bash

# AI Ticket Support Chatbot - Startup Script (Unix/Linux/Mac)
# This script starts the Flask backend server which also serves the frontend

echo "========================================================"
echo "Starting AI Ticket Support Chatbot Backend..."
echo "========================================================"
echo ""

# Check if Python is installed
echo "Checking Python and dependencies..."
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed or not in PATH"
    echo "Please install Python 3.8 or higher"
    exit 1
fi

python3 --version
echo ""

# Check if virtual environment exists, if not create it
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install/upgrade dependencies
echo "Installing/updating dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo ""
echo "========================================================"
echo "Starting Flask server on http://localhost:5000"
echo ""
echo "The chatbot will be available at http://localhost:5000"
echo "Press Ctrl+C to stop the server"
echo "========================================================"
echo ""

# Start Flask application
python3 app.py