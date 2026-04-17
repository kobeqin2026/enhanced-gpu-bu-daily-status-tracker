#!/bin/bash
# =============================================================================
# GPU Bring-up Tracker - Smoke Tests
# Usage: ./smoke_test.sh [BASE_URL]
# Default BASE_URL: http://localhost:8088
#
# Tests:
# 1. Frontend Accessibility (200 OK)
# 2. API Health Check (Project list valid)
# 3. Data Integrity (Project data load)
# =============================================================================

BASE_URL=${1:-"http://localhost:8088"}

PASS=0
FAIL=0

echo "🚀 Running Smoke Tests against $BASE_URL"
echo "--------------------------------------"

# Test 1: Frontend Accessibility
# Checks if the main page loads successfully
echo -n "1. Check Frontend Load ($BASE_URL/)... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/")
if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ PASS (HTTP 200)"
    PASS=$((PASS + 1))
else
    echo "❌ FAIL (HTTP $HTTP_CODE)"
    FAIL=$((FAIL + 1))
fi

# Test 2: API Health
# Checks if the API returns a list of projects
echo -n "2. Check API Health ($BASE_URL/api/projects)... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/projects")
RESPONSE=$(curl -s "$BASE_URL/api/projects")
# Check if response contains a project ID (implies valid JSON array with content)
if [ "$HTTP_CODE" -eq 200 ] && echo "$RESPONSE" | grep -q '"id"'; then
    echo "✅ PASS (HTTP 200, valid project list)"
    PASS=$((PASS + 1))
else
    echo "❌ FAIL (HTTP $HTTP_CODE or invalid response)"
    FAIL=$((FAIL + 1))
fi

# Test 3: Data Integrity
# Checks if we can load data for the default 'gpu-bringup' project
echo -n "3. Check Data Integrity ($BASE_URL/api/data?project=gpu-bringup)... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/data?project=gpu-bringup")
RESPONSE=$(curl -s "$BASE_URL/api/data?project=gpu-bringup")
# Check if response contains 'domains' key
if [ "$HTTP_CODE" -eq 200 ] && echo "$RESPONSE" | grep -q '"domains"'; then
    echo "✅ PASS (HTTP 200, contains project data)"
    PASS=$((PASS + 1))
else
    echo "❌ FAIL (HTTP $HTTP_CODE or missing data)"
    FAIL=$((FAIL + 1))
fi

echo "--------------------------------------"
echo "🏁 Results: $PASS Passed, $FAIL Failed"

if [ $FAIL -gt 0 ]; then
    echo "❌ Some tests failed!"
    exit 1
fi
echo "✅ All smoke tests passed!"
exit 0
