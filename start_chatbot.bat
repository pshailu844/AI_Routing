@echo off
echo Starting AI Ticket Support Chatbot Backend...
echo.
echo Checking Python version...
python --version
echo.

echo Checking and installing dependencies...
pip install --quiet --upgrade pip
pip install --quiet -r requirements_chatbot.txt
echo [OK] All dependencies installed
echo.

echo Starting Flask server on http://localhost:5000
echo.
echo The chatbot will be available at http://localhost:5000
echo Press Ctrl+C to stop the server
echo.

python app.py

pause