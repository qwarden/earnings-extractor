import { NextRequest, NextResponse } from "next/server";
import { isValidSession, isAuthEnabled, COOKIE_NAME } from "@/lib/auth";

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

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
