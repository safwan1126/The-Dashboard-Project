import { updatePassword } from "@/app/auth/actions";
import styles from "../auth.module.css";

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.brand}>LifeOS</div>
        <h1 className={styles.title}>Set a new password</h1>
        <p className={styles.sub}>Choose a new password for your account</p>

        {error && <div className={styles.error}>{error}</div>}

        <form action={updatePassword} className={styles.form}>
          <label className={styles.label}>
            New password
            <input className={styles.input} type="password" name="password" required minLength={6} autoComplete="new-password" />
          </label>
          <button className={styles.button} type="submit">Update password</button>
        </form>
      </div>
    </div>
  );
}
