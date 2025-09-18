// functions/_middleware.ts
export const onRequest: PagesFunction = async ({ request, next }) => {
  const { pathname } = new URL(request.url);
  // ここは必ず Functions に通す
  if (pathname.startsWith("/line/") || pathname.startsWith("/debug/")) {
    return next();
  }
  return next();
};
