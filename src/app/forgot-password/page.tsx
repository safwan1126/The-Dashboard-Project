import Link from "next/link";
import { requestPasswordReset } from "@/app/auth/actions";
import styles from "../auth.module.css";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.brand}>LifeOS</div>
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.sub}>We&apos;ll email you a link to set a new one</p>

        {notice && <div className={styles.notice}>{notice}</div>}
        {error && <div className={styles.error}>{error}</div>}

        <form action={requestPasswordReset} className={styles.form}>
          <label className={styles.label}>
            Email
            <input className={styles.input} type="email" name="email" required autoComplete="email" />
          </label>
          <button className={styles.button} type="submit">Send reset link</button>
        </form>

        <p className={styles.foot}>
          <Link className={styles.link} href="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
