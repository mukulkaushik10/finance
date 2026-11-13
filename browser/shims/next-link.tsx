import * as React from "react";
import { rt } from "../runtime/core";

const Link = React.forwardRef<HTMLAnchorElement, any>(function Link({ href, children, prefetch: _p, replace, scroll: _s, onClick, ...rest }, ref) {
  const url = typeof href === "string" ? href : `${href.pathname ?? ""}${href.query ? "?" + new URLSearchParams(href.query).toString() : ""}`;
  return (
    <a ref={ref} href={url} {...rest} onClick={(e) => {
      onClick?.(e);
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || rest.target === "_blank") return;
      e.preventDefault(); rt.navigate(url, { replace });
    }}>{children}</a>
  );
});
export default Link;
