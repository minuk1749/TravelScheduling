import { auth } from '../auth';
import { login, logout, withdraw } from './actions';

export default async function Home() {
  const session = await auth();
  return (
    <main>
      <p className="eyebrow">여행 동선</p>
      <h1>가고 싶은 곳을,<br />여행의 하루로.</h1>
      <p>항공 일정과 숙소, 방문할 장소를 모아 나에게 맞는 여행 동선을 준비하세요.</p>
      <p className="notice">여행 일정 기능을 준비하고 있습니다.</p>
      {session?.user?.id ? <>
        <form action={logout}><button type="submit">로그아웃</button></form>
        <form action={withdraw}><p>탈퇴하면 계정과 여행 데이터가 모두 삭제됩니다.</p><button type="submit">회원 탈퇴</button></form>
      </> : <form action={login}><button type="submit">Google로 로그인</button></form>}
      <p>로그인 시 Google 계정 ID와 이메일을 수집하며, 탈퇴 시 계정과 여행 데이터를 삭제합니다.</p>
    </main>
  );
}
