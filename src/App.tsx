import { useEffect, useMemo, useState } from "react";
import { getChart } from "./charts";
import { Library } from "./pages/Library";
import { parseLink } from "./pages/share";
import { TunePage } from "./pages/TunePage";

/** Hash routes, so the site works on any static host: #/ is the library, #/tune/<id> a tune. */
function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHash();
  const id = /^#\/tune\/([a-z0-9-]+)/.exec(hash)?.[1];
  const chart = id ? getChart(id) : undefined;
  useEffect(() => {
    document.title = chart ? `${chart.title} · Jazz Player` : "Jazz Player";
  }, [chart]);
  // The address can carry settings after a ?, which the tune reads once when it opens.
  const link = useMemo(() => parseLink(hash), [hash]);
  return chart ? <TunePage key={chart.id} chart={chart} link={link} /> : <Library />;
}
