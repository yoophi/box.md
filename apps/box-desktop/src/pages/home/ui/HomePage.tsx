import { CheckRuntime } from "@/features/check-runtime";

export function HomePage() {
  return (
    <main className="home">
      <header className="masthead"><span className="wordmark">box.md<span>▧</span></span><span className="edition">생각의 보관함</span></header>
      <section className="introduction" aria-labelledby="home-title">
        <span className="eyebrow">A PLACE FOR YOUR THOUGHTS</span>
        <h1 id="home-title">작은 생각이<br />연결되는 곳.</h1>
        <p className="description">생각을 수집하고, 기록하고, 연결하는 나만의 공간.</p>
        <CheckRuntime />
      </section>
      <footer className="footnote"><span>수집 · 기록 · 연결</span><span>box.md / 01</span></footer>
    </main>
  );
}
