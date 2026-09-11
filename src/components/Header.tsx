type HeaderProps = {
  kicker: string;
  title: string;
  sub: string;
};

export function Header({ kicker, title, sub }: HeaderProps) {
  return (
    <header>
      <small>{kicker}</small>
      <h1>{title}</h1>
      <p>{sub}</p>
    </header>
  );
}
