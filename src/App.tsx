import { lazy, Suspense, useEffect, useState } from "react";
import { useRoute } from "./lib/router";
import { Gate, isUnlocked } from "./pages/Gate";
import { LaptopOnly, isMobile } from "./pages/LaptopOnly";
import { Landing } from "./pages/Landing";
import { Research } from "./pages/Research";
import { Takes } from "./pages/Takes";

const Studio = lazy(() => import("./studio/Studio"));
const Review = lazy(() => import("./pages/Review"));

export function App() {
  const route = useRoute();
  const page = route.parts[0] ?? "";
  const [open, setOpen] = useState(() => isUnlocked() || route.query.get("booth") === "1");
  useEffect(() => {
    if (page !== "review") window.scrollTo(0, 0);
  }, [page]);
  if (isMobile()) return <LaptopOnly />;
  if (!open) return <Gate onUnlock={() => setOpen(true)} />;
  return (
    <Suspense fallback={<div className="page-loading" />}>
      {page === "studio" ? <Studio query={route.query} />
        : page === "takes" ? <Takes />
        : page === "research" ? <Research />
        : page === "review" ? <Review id={route.parts[1] ?? ""} query={route.query} />
        : <Landing />}
    </Suspense>
  );
}
