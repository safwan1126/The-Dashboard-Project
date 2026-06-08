import Link from "next/link";
import { signUp } from "@/app/auth/actions";
import styles from "../auth.module.css";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.brand}>NeeyazOS</div>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.sub}>Set up your personal operating system</p>

        {error && <div className={styles.error}>{error}</div>}

        <form action={signUp} className={styles.form}>
          <label className={styles.label}>
            Email
            <input className={styles.input} type="email" name="email" required autoComplete="email" />
          </label>
          <label className={styles.label}>
            Password
            <input className={styles.input} type="password" name="password" required minLength={6} autoComplete="new-password" />
          </label>
          <button className={styles.button} type="submit">Sign up</button>
        </form>

        <p className={styles.foot}>
          Already have an account?{" "}
          <Link className={styles.link} href="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
