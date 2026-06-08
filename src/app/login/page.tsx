import Link from "next/link";
import { signIn } from "@/app/auth/actions";
import styles from "../auth.module.css";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.brand}>NeeyazOS</div>
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.sub}>Sign in to open your dashboard</p>

        {notice && <div className={styles.notice}>{notice}</div>}
        {error && <div className={styles.error}>{error}</div>}

        <form action={signIn} className={styles.form}>
          <label className={styles.label}>
            Email
            <input className={styles.input} type="email" name="email" required autoComplete="email" />
          </label>
          <label className={styles.label}>
            Password
            <input className={styles.input} type="password" name="password" required autoComplete="current-password" />
          </label>
          <button className={styles.button} type="submit">Sign in</button>
        </form>

        <p className={styles.foot}>
          New here?{" "}
          <Link className={styles.link} href="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
