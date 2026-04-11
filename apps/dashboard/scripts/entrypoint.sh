#!/bin/sh
if [ -n "$NEXT_PUBLIC_API_URL" ]; then
  echo "Injecting NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}"
  find /app/.next -name "*.js" -exec sed -i "s|__NEXT_PUBLIC_API_URL_PLACEHOLDER__|${NEXT_PUBLIC_API_URL}|g" {} +
else
  echo "Using relative URLs (no NEXT_PUBLIC_API_URL set)"
  find /app/.next -name "*.js" -exec sed -i "s|__NEXT_PUBLIC_API_URL_PLACEHOLDER__||g" {} +
fi
exec node server.js
