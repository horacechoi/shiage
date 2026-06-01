// A small demo surface for the Shiage flow. Pick any element below, tweak its CSS in DevTools
// (padding, color, radius, …), then "Save" — the change is written back here as Tailwind classes.
export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-8">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Shiage</h1>
        <p className="mb-6 text-slate-600">
          Edit this card&rsquo;s CSS in Chrome DevTools, then save it back to source as Tailwind
          class edits — the finishing touches.
        </p>
        <button className="rounded-md bg-brand px-4 py-2 font-medium text-white">
          Pick me &amp; tweak my padding
        </button>
      </div>
    </main>
  )
}
