#!/bin/sh
if [ -n "$NEXT_PUBLIC_API_URL" ]; then
  echo "Injecting NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}"
  find /app/apps/dashboard/.next -name "*.js" -exec sed -i "s|__NEXT_PUBLIC_API_URL_PLACEHOLDER__|${NEXT_PUBLIC_API_URL}|g" {} +
else
  echo "Using relative URLs (no NEXT_PUBLIC_API_URL set)"
  find /app/apps/dashboard/.next -name "*.js" -exec sed -i "s|__NEXT_PUBLIC_API_URL_PLACEHOLDER__||g" {} +
fi
exec node apps/dashboard/server.js
