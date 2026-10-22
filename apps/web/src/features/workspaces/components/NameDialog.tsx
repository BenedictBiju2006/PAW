"use client";
export function NameDialog({
  error,
  title,
  label,
  initial = "",
  submit,
  busy,
  close,
  save,
}: {
  title: string;
  label: string;
  initial?: string;
  submit: string;
  error: string;
  busy: boolean;
  close: () => void;
  save: (value: string) => void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button className="modal-close icon" onClick={close} aria-label="Close">
          ×
        </button>
        <h2>{title}</h2>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(String(new FormData(e.currentTarget).get("name")));
          }}
        >
          <label>
            {label}
            <input
              autoFocus
              name="name"
              defaultValue={initial}
              maxLength={100}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : submit}
          </button>
        </form>
      </section>
    </div>
  );
}