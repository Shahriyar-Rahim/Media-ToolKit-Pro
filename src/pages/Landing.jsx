import React from 'react';
import { Video, Music, Image, FileText, Archive, WifiOff, ShieldCheck } from 'lucide-react';
import { Btn } from '../components/ui.jsx';

const FEATURES = [[Video, 'Video compression', 'Shrink videos with H.264 or maximum-compression H.265. GPU acceleration is used where your computer supports it, with an automatic CPU fallback.'], [Music, 'Audio tools', 'Compress, convert and extract audio to MP3, AAC, WAV or FLAC.'], [Image, 'Image tools', 'Convert HEIC photos and other images to JPG in batches. One bad file never stops the rest.'], [FileText, 'PDF tools', 'Turn images into a single PDF and merge PDFs in the order you choose.'], [Archive, 'Media Vault', 'Every job is logged locally so you can search, reopen and find your files again.']];

export default function Landing({ goto }) {
  return (
    <div className="max-w-4xl mx-auto py-10 px-6">
      <header className="flex items-center justify-between mb-14"><strong className="text-lg">Media Toolkit Pro</strong>
        <nav aria-label="Site" className="flex gap-2"><Btn onClick={() => goto('pricing')}>Pricing</Btn><Btn onClick={() => goto('help')}>Help</Btn><Btn onClick={() => goto('contact')}>Contact</Btn><Btn onClick={() => goto('login')}>Log in</Btn><Btn primary onClick={() => goto('register')}>Register</Btn></nav></header>
      <h1 className="text-4xl font-bold leading-tight mb-4">Compress, convert and organise your media. On your own computer.</h1>
      <p className="text-lg mb-6" style={{ color: 'var(--mute)' }}>Media Toolkit Pro processes videos, audio, images and PDFs locally. Your files are never uploaded.</p>
      <div className="flex gap-3 mb-14"><Btn primary onClick={() => goto('register')}>Get started</Btn><Btn onClick={() => goto('pricing')}>See pricing</Btn></div>
      <div className="grid gap-4 md:grid-cols-2 mb-10">{FEATURES.map(([Icon, t, d]) => <div key={t} className="panel p-4"><Icon size={20} className="mb-2" style={{ color: 'var(--accent)' }} /><h2 className="font-semibold mb-1">{t}</h2><p style={{ color: 'var(--mute)' }}>{d}</p></div>)}</div>
      <div className="grid gap-4 md:grid-cols-2 mb-10">
        <div className="panel p-4"><WifiOff size={20} className="mb-2" style={{ color: 'var(--accent)' }} /><h2 className="font-semibold mb-1">Works offline</h2><p style={{ color: 'var(--mute)' }}>Processing needs no internet. You only go online to sign in, manage your plan or pay. Your plan is cached securely so short offline periods are fine.</p></div>
        <div className="panel p-4"><ShieldCheck size={20} className="mb-2" style={{ color: 'var(--accent)' }} /><h2 className="font-semibold mb-1">Private by design</h2><p style={{ color: 'var(--mute)' }}>Only your account and subscription live on our servers. Media, history and settings stay on your device.</p></div></div>
      <section className="panel p-6 text-center"><h2 className="text-xl font-semibold mb-2">Start with a free trial</h2><p className="mb-4" style={{ color: 'var(--mute)' }}>Create an account, verify your email and try the tools. Paid plans unlock more when you need them.</p><Btn primary onClick={() => goto('register')}>Create your account</Btn></section>
    </div>
  );
}
