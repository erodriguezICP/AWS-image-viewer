
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Grid2X2,
  Rows3,
  X,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Settings2,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
const sampleImages = [
  { key: "archive/photograph-001.jpg", title: "Museum facade", url: "https://images.unsplash.com/photo-1561214115-f2f134cc4912?auto=format&fit=crop&w=1200&q=80", size: "2.4 MB" },
  { key: "archive/photograph-002.jpg", title: "Gallery installation", url: "https://images.unsplash.com/photo-1549490349-8643362247b5?auto=format&fit=crop&w=1200&q=80", size: "1.8 MB" },
  { key: "archive/photograph-003.jpg", title: "Sculpture study", url: "https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&w=1200&q=80", size: "3.1 MB" },
  { key: "archive/photograph-004.jpg", title: "Collection detail", url: "https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=1200&q=80", size: "2.0 MB" },
  { key: "archive/photograph-005.jpg", title: "Exhibition room", url: "https://images.unsplash.com/photo-1577083288073-40892c0860a4?auto=format&fit=crop&w=1200&q=80", size: "2.7 MB" },
  { key: "archive/photograph-006.jpg", title: "Archive object", url: "https://images.unsplash.com/photo-1564399579883-451a5d44ec08?auto=format&fit=crop&w=1200&q=80", size: "1.5 MB" },
];

export default function App() {
  const [query, setQuery] = useState("");
  const [view, setView] = useState("grid");
  const [selected, setSelected] = useState(null);
  const [bucketUrl, setBucketUrl] = useState("https://YOUR-BUCKET.s3.amazonaws.com");
  const [showConfig, setShowConfig] = useState(false);

  const images = useMemo(() => sampleImages.filter((item) => `${item.title} ${item.key}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const selectedIndex = selected ? images.findIndex((item) => item.key === selected.key) : -1;

  const move = (direction) => {
    if (!images.length) return;
    const next = (selectedIndex + direction + images.length) % images.length;
    setSelected(images[next]);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (!selected) return;
      if (event.key === "Escape") setSelected(null);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedIndex, images]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-400/20">
            <ImageIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">Archive Image Viewer</h1>
            <p className="truncate text-sm text-slate-400">Vite + React + Amplify Hosting + Amazon S3</p>
          </div>
          <Button variant="outline" className="rounded-xl border-white/15 bg-white/5 hover:bg-white/10" onClick={() => setShowConfig((v) => !v)}>
            <Settings2 className="mr-2 h-4 w-4" /> Configure
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-7">
        <AnimatePresence>
          {showConfig && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <Card className="mb-6 rounded-2xl border-cyan-400/20 bg-cyan-400/5 text-slate-100 shadow-xl">
                <CardContent className="p-5">
                  <div className="mb-3 flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 text-cyan-300" />
                    <div>
                      <h2 className="font-semibold">S3 connection</h2>
                      <p className="text-sm text-slate-400">Replace the sample collection with objects returned by Amplify Storage. Do not put AWS access keys in the browser.</p>
                    </div>
                  </div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">Public bucket or CloudFront base URL</label>
                  <Input value={bucketUrl} onChange={(e) => setBucketUrl(e.target.value)} className="rounded-xl border-white/10 bg-slate-900 text-slate-100" />
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <section className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search filename or title" className="h-11 rounded-xl border-white/10 bg-white/5 pl-10 text-slate-100 placeholder:text-slate-500" />
          </div>
          <div className="flex items-center gap-2">
            <Button aria-label="Grid view" variant={view === "grid" ? "default" : "outline"} className="rounded-xl" onClick={() => setView("grid")}><Grid2X2 className="h-4 w-4" /></Button>
            <Button aria-label="List view" variant={view === "list" ? "default" : "outline"} className="rounded-xl" onClick={() => setView("list")}><Rows3 className="h-4 w-4" /></Button>
          </div>
        </section>

how do i make the user go from login page to image viewer page


View file src/App.tsx
Your main.tsx already handles the login-to-app transition: once sign-in succeeds, <Authenticator> renders <App />. The reason users don’t see an image viewer yet is that App currently renders the todo screen.
Replace the todo UI in src/App.tsx with your image viewer component. For example, if you have or create src/ImageViewer.tsx:
src/App.tsx

import { useAuthenticator } from "@aws-amplify/ui-react";
import ImageViewer from "./ImageViewer";

function App() {
  const { signOut } = useAuthenticator();

You don’t need a redirect or routing library if the image viewer is the only screen after login. Keep the <Authenticator> wrapper in src/main.tsx; signing out will take the user back to the login screen.














Files


tT






amplify




amplify_outputs




public




src




assets



App.css



App.tsx



index.css



main.tsx



vite-env.d.ts



.gitignore



CODE_OF_CONDUCT.md



CONTRIBUTING.md



LICENSE



README.md



amplify.yml



eslint.config.js



index.html



package-lock.json



package.json



tsconfig.json



tsconfig.node.json



vite.config.ts


AWS-image-viewer
/src
/App.tsx


erodriguezICP

Refactor todo creation and subscription handling
f3cdd19 · 1 hour ago


Code

Blame

69 lines (55 loc) · 1.58 KB





















































































Content previewWorkbench
Press Delete to close the focussed tab.
src/App.tsx


        <div className="mb-4 flex items-end justify-between">
          <div><h2 className="text-2xl font-semibold">Collection</h2><p className="text-sm text-slate-400">{images.length} images</p></div>
          <span className="max-w-[45%] truncate rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400">{bucketUrl}</span>
        </div>

        {view === "grid" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image, index) => (
              <motion.button key={image.key} layout whileHover={{ y: -4 }} onClick={() => setSelected(image)} className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left shadow-lg transition hover:border-cyan-300/40">
                <div className="aspect-[4/3] overflow-hidden bg-slate-900"><img src={image.url} alt={image.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /></div>
                <div className="p-4"><h3 className="font-medium">{image.title}</h3><p className="mt-1 truncate text-xs text-slate-500">{image.key}</p><p className="mt-3 text-xs text-slate-400">{image.size}</p></div>
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {images.map((image) => (
              <button key={image.key} onClick={() => setSelected(image)} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-left hover:border-cyan-300/40">
                <img src={image.url} alt={image.title} className="h-20 w-24 rounded-xl object-cover" />
                <div className="min-w-0 flex-1"><h3 className="font-medium">{image.title}</h3><p className="truncate text-sm text-slate-500">{image.key}</p></div>
                <span className="text-sm text-slate-400">{image.size}</span>
              </button>
            ))}
          </div>
        )}

        {!images.length && <div className="rounded-2xl border border-dashed border-white/15 py-20 text-center text-slate-400">No images match “{query}”.</div>}
      </main>

      <AnimatePresence>
        {selected && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelected(null)}>
            <Button aria-label="Close" variant="ghost" className="absolute right-4 top-4 rounded-full text-white" onClick={() => setSelected(null)}><X /></Button>
            <Button aria-label="Previous" variant="ghost" className="absolute left-3 rounded-full text-white" onClick={(e) => { e.stopPropagation(); move(-1); }}><ChevronLeft className="h-8 w-8" /></Button>
            <motion.div key={selected.key} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="max-w-5xl" onClick={(e) => e.stopPropagation()}>
              <img src={selected.url} alt={selected.title} className="max-h-[78vh] w-auto rounded-2xl object-contain shadow-2xl" />
              <div className="mt-4 flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{selected.title}</h2><p className="text-sm text-slate-400">{selected.key}</p></div><a href={selected.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-cyan-300">Open original <ExternalLink className="h-4 w-4" /></a></div>
            </motion.div>
            <Button aria-label="Next" variant="ghost" className="absolute right-3 rounded-full text-white" onClick={(e) => { e.stopPropagation(); move(1); }}><ChevronRight className="h-8 w-8" /></Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
