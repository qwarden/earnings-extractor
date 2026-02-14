import { NextRequest, NextResponse } from "next/server";
import { isValidSession, isAuthEnabled, COOKIE_NAME } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const PUBLIC_PATHS = ["/login", "/api/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico")
  ) {
    return NextResponse.next();
  }

  // Auth check
  if (isAuthEnabled()) {
    if (!isPublicPath(pathname)) {
      const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
      const valid = await isValidSession(sessionCookie);
      if (!valid) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
          );
        }
        const loginUrl = new URL("/login", request.url);
        return NextResponse.redirect(loginUrl);
      }
    }

    // If already logged in and on /login, redirect to home
    if (pathname === "/login") {
      const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
      const valid = await isValidSession(sessionCookie);
      if (valid) {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
  }

  // Rate limiting for extract endpoint
  if (pathname === "/api/extract") {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const result = checkRateLimit(ip);

    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil((result.retryAfterMs || 0) / 1000);
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
