import { ArrowUpRight, Film, Image as ImageIcon, Layers3 } from 'lucide-react';
import { BrandMark } from './brand-mark';
import { SocialLinks } from './social-links';
import { LegalNotice } from './legal-notice';

export function About({ onCreate, onSetup }: { onCreate: () => void; onSetup: () => void }) {
  return <article className="about-page">
    <div className="about-eyebrow"><BrandMark size={22}/> Frok</div>
    <h1>Big ideas.<br/><span>Local possibilities.</span></h1>
    <p className="about-lead">A home for the things you haven’t created yet. Turn words into images and still frames into stories, in your own local studio.</p>
    <button className="about-create" onClick={onCreate}>Start creating <ArrowUpRight size={17}/></button>
    <div className="about-features">
      <section><ImageIcon size={21} strokeWidth={1.5}/><h2>Find your next idea.</h2><p>Explore a batch of images, try another direction, and save the ones that stay with you.</p></section>
      <section><Film size={21} strokeWidth={1.5}/><h2>Give it a little motion.</h2><p>Animate a favorite image, build a video from words or references, and keep every version together.</p></section>
      <section><Layers3 size={21} strokeWidth={1.5}/><h2>Make it your own.</h2><p>Connect your tools, choose image/video pipelines and a prompt model, and let your queue take care of the work.</p></section>
    </div>
    <div className="about-local"><p>No sign-up. Your library, history and settings stay on your device. Connect local tools, download the models you need, and create with your own hardware.</p></div>
    <LegalNotice/>
    <footer><div><p>New here?</p><button onClick={onSetup}>Open the setup guide <ArrowUpRight size={13}/></button></div><SocialLinks labels/></footer>
  </article>;
}
