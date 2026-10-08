'use client';

import { useState } from 'react';
import AccountLinks from './account-links';
import ProjectGallery from './project-gallery';
import ContactForm from './contact-form';

const capabilities = [
  ['01', 'Web applications', 'Purpose-built portals, dashboards, and business tools that fit the way your team works.'],
  ['02', 'Business workflows', 'Turn repetitive processes into connected software, from customer intake to day-to-day operations.'],
  ['03', 'Integrations & APIs', 'Connect your systems and bring the information you need into one practical workflow.'],
];

export default function Home() {
  const [menu, setMenu] = useState(false);
  const [interest, setInterest] = useState('Custom software');
  function inquire(service: string) {
    const selected = service === 'InTouch' ? 'InTouch CRM' : service;
    setInterest(['Custom software', 'InTouch CRM', 'IterateView', 'Surveillance solutions'].includes(selected) ? selected : 'Something else');
  }
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="header">
      <a className="brand" href="#" aria-label="Ablests Digital Solution home"><span className="brand-mark">a<span>.</span></span><span>ablests<small>DIGITAL SOLUTION</small></span></a>
      <button className="menu-toggle" aria-expanded={menu} aria-controls="navigation" onClick={() => setMenu(!menu)}>{menu ? 'Close' : 'Menu'}</button>
      <nav id="navigation" className={menu ? 'nav open' : 'nav'} aria-label="Main navigation">
        <AccountLinks onNavigate={() => setMenu(false)}/>
        <a href="#services" onClick={() => setMenu(false)}>Services</a><a href="#products" onClick={() => setMenu(false)}>Our products</a><a href="#next" onClick={() => setMenu(false)}>Coming soon</a><a className="button small" href="#contact" onClick={() => { setMenu(false); inquire('Custom software'); }}>Let’s talk</a>
      </nav>
    </header>
    <main id="main">
      <section className="hero section-wrap">
        <div className="hero-copy"><p className="eyebrow">CUSTOM SOFTWARE. REAL BUSINESS NEEDS.</p><h1>Your next move.<br/>Built <em>for you.</em></h1><p className="lead">Software should fit your business. We build custom digital solutions that connect your people, simplify your work, and give your ideas room to grow.</p><div className="actions"><a className="button" href="#contact" onClick={() => inquire('Custom software')}>Discuss your project</a><a className="text-link" href="#products">Explore our products</a></div><div className="hero-footnote"><span>Built around your workflow</span><span>Designed for everyday use</span></div></div>
        <div className="hero-panel"><div className="panel-top"><span>THE ABLESTS APPROACH</span><span className="plus">+</span></div><div className="statement">Your ideas.<br/>Our craft.<br/><span>One solution.</span></div><div className="panel-bottom"><span>From the first conversation<br/>to the software you use.</span><span className="monogram">A/</span></div></div>
      </section>
      <div className="service-strip"><span>Custom development</span><span>Business software</span><span>Connected systems</span><span>Purpose-built products</span></div>
      <section className="section-wrap services" id="services"><div className="section-heading"><div><p className="eyebrow">01 / WHAT WE DO</p><h2>Built around the way<br/>you do business.</h2></div><p>Start with the problem you want to solve. We help shape the right solution, then build it with clear priorities and a practical path forward.</p></div><div className="capabilities">{capabilities.map(([number, title, copy]) => <article key={number}><span className="index">{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
      <section className="products section-wrap" id="products"><div className="section-heading"><div><p className="eyebrow">02 / OUR PRODUCTS</p><h2>Ideas becoming<br/><em>everyday tools.</em></h2></div><p>Alongside custom development, we’re building our own software for business relationships and better trading review.</p></div>
        <ProjectGallery inquire={inquire}/>
      </section>
      <section className="next-section" id="next"><div className="section-wrap next-inner"><div><p className="eyebrow">03 / WHAT’S NEXT</p><span className="badge">Coming soon</span><h2>A clearer view<br/>of your security.</h2><p>We’re planning surveillance camera installation services and a companion software solution. Hardware and software, developed with everyday visibility in mind.</p><a className="text-link" href="#contact" onClick={() => inquire('Surveillance solutions')}>Ask about future availability</a></div><div className="next-list"><article><span>01 / ON-SITE</span><h3>Surveillance camera installation</h3><p>A planned service to help businesses set up their surveillance cameras. Service area and availability will be announced.</p></article><article><span>02 / DIGITAL</span><h3>Companion surveillance software</h3><p>A future software product to support the camera experience. Features and launch details are still being defined.</p></article></div></div></section>
      <section className="section-wrap process"><div><p className="eyebrow">04 / HOW WE WORK</p><h2>Good software starts<br/>with understanding.</h2></div><ol><li><span>01</span><div><h3>Understand the need</h3><p>Talk through your goals, your current workflow, and what needs to change.</p></div></li><li><span>02</span><div><h3>Shape the solution</h3><p>Agree on the scope, priorities, and a plan that fits your project.</p></div></li><li><span>03</span><div><h3>Build and refine</h3><p>Develop in focused steps, review progress together, and refine the details.</p></div></li></ol></section>
      <section className="contact section-wrap" id="contact"><div className="contact-copy"><p className="eyebrow">LET’S BUILD SOMETHING USEFUL</p><h2>What’s your<br/><em>next move?</em></h2><p>Tell us what you’re working on. Whether it’s custom software or a question about our products, the conversation starts here.</p><a href="mailto:ablestdigitalsolutions@gmail.com" className="email">ablestdigitalsolutions@gmail.com</a></div><ContactForm interest={interest} onInterestChange={setInterest}/></section>
    </main>
    <footer className="section-wrap footer"><a className="brand" href="#"><span className="brand-mark">a<span>.</span></span><span>ablests<small>DIGITAL SOLUTION</small></span></a><p>Custom software. Thoughtful solutions.</p><span>© {new Date().getFullYear()} Ablests Digital Solution</span></footer>
  </>;
}
