'use client';
import { useEffect, useState } from 'react';
import { api, type Project } from './lib/projects';
function Product({ project, index, inquire }: { project: Project; index: number; inquire: (service: string) => void }) {
  const [selected, setSelected] = useState(0);
  const image = project.images[selected] || project.images[0];
  return <article className={`product ${index % 2 ? 'iterate' : 'intouch'}`}><div className="product-copy"><div className="product-meta"><span>{project.category.toUpperCase()}</span><span className="badge">{project.status}</span></div><h3>{project.title}<span>{project.subtitle}</span></h3><p>{project.description}</p>{project.features.length > 0 && <ul className="feature-list">{project.features.map((feature, i) => <li key={i}>{feature}</li>)}</ul>}{project.url ? <a className="text-link" href={project.url} target="_blank" rel="noopener noreferrer">Visit {project.title}</a> : <a className="text-link" href="#contact" onClick={() => inquire(project.title)}>Ask about {project.title}</a>}</div>
    {image ? <div className="portfolio-gallery"><img className="portfolio-cover" src={`/api/images/${image.id}`} alt={image.alt}/>{project.images.length > 1 && <div className="portfolio-thumbnails" aria-label={`${project.title} images`}>{project.images.map((item, i) => <button key={item.id} type="button" aria-label={`View image ${i + 1}: ${item.alt}`} aria-pressed={i === selected} onClick={() => setSelected(i)}><img src={`/api/images/${item.id}`} alt="" loading="lazy"/></button>)}</div>}<p>{image.alt}</p></div> : <div className={`product-visual ${index % 2 ? 'review-visual' : 'crm-visual'}`}><div className="visual-label">{project.title === 'InTouch' ? 'FROM FIRST CONTACT TO WHAT’S NEXT' : project.title === 'IterateView' ? 'A MORE INTENTIONAL REVIEW CYCLE' : project.category.toUpperCase()}</div>{(project.title === 'InTouch' ? ['Connect', 'Organize', 'Follow through'] : project.title === 'IterateView' ? ['Record', 'Review', 'Improve'] : [project.title]).map((word, i) => <div key={word} className={`review-word ${i === 2 ? 'accent' : ''}`}><span>0{i + 1}</span>{word}</div>)}</div>}
  </article>;
}
export default function ProjectGallery({ inquire }: { inquire: (service: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null), [error, setError] = useState(false);
  async function load() { setError(false); try { setProjects(await api<Project[]>('projects')); } catch { setError(true); } }
  useEffect(() => { void load(); }, []);
  if (error) return <div className="portfolio-empty"><p>Our project portfolio is temporarily unavailable.</p><button className="text-button" onClick={load}>Try again</button></div>;
  if (!projects) return <p className="portfolio-empty" role="status">Loading our projects…</p>;
  if (!projects.length) return <p className="portfolio-empty">New projects are on the way. Talk to us about what you’d like to build.</p>;
  return <>{projects.map((project, index) => <Product key={project.id} project={project} index={index} inquire={inquire}/>)}</>;
}
