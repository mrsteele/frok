import type { Metadata } from "next";
import { Suspense } from "react";
import Studio from "@/components/studio";
import { NavigationTracker } from "@/components/page-shell";
import "./globals.css";
export const metadata:Metadata={title:"Frok — Your local imagination",description:"Create images and videos on your own machine. A private, local creative studio powered by Vpipe, ComfyUI, and Ollama."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><Suspense fallback={<p className="session-bootstrap">Opening your studio…</p>}><NavigationTracker/><Studio>{children}</Studio></Suspense></body></html>;}
