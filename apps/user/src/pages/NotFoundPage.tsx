import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="page">
      <h1>Không tìm thấy trang</h1>
      <Link to="/" className="button button-block">
        Về trang chủ
      </Link>
    </main>
  );
}
