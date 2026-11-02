#!/bin/bash
exec 3<>/dev/tcp/nightshift-mailpit/1025
echo "EHLO test" >&3
read -r line <&3
echo "HELO: $line"
echo "MAIL FROM:<test@test.com>" >&3
read -r line <&3
echo "MAIL: $line"
echo "RCPT TO:<user@test.com>" >&3
read -r line <&3
echo "RCPT: $line"
echo "DATA" >&3
read -r line <&3
echo "DATA: $line"
echo "Subject: Test" >&3
echo "" >&3
echo "Hello from stand" >&3
echo "." >&3
read -r line <&3
echo "END: $line"
echo "QUIT" >&3
exec 3>&-