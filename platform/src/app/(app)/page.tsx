import Link from 'next/link'

// 落地页（/）。第一期主要入口是 /admin（Payload 后台），这里只放一个简洁的引导页。
export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        background: '#fafafa',
        color: '#1a1a1a',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '2rem', margin: 0, fontWeight: 600 }}>LiLink 内容中台</h1>
      <p style={{ color: '#666', margin: 0 }}>多平台内容发布 · 第一期：公众号闭环</p>
      <Link
        href="/admin"
        style={{
          marginTop: '0.5rem',
          padding: '0.65rem 1.5rem',
          background: '#1a1a1a',
          color: '#fff',
          borderRadius: '8px',
          textDecoration: 'none',
          fontSize: '0.95rem',
        }}
      >
        进入后台 →
      </Link>
    </main>
  )
}
