# aiKu — Lightweight Local Desktop File Assistant (P0 Security)

Asisten pengelola file lokal berbasis **TypeScript (Strict Mode + Zod)** dan **node-llama-cpp (CPU-Only, tanpa Ollama)** menggunakan model **Qwen2.5-0.5B-Instruct (GGUF `Q4_K_M`, ~400 MB)** dengan keamanan sistem file sebagai prioritas tertinggi (P0).

## Arsitektur Keamanan (P0)
1. **Output Terkunci via GBNF Grammar + Zod:** AI hanya menghasilkan JSON valid dengan aksi `"MOVE" | "RENAME" | "SKIP"`. Aksi `"DELETE"` dilarang secara struktural di GBNF Grammar, skema Zod, dan `SafeExecutor`.
2. **Strict Sandbox & Anti-Path Traversal:** Semua path divalidasi dengan `path.resolve()` dan `fs.realpath()` (anti symlink-escape) serta menolak jalur sensitif (`C:\Windows`, `Program Files`, `.git`, `.ssh`, `.env`, `node_modules`).
3. **Anti-Overwrite & Soft Delete Karantina:** Jika file tujuan sudah ada, otomatis ditambahkan suffix berurutan (`file_1.pdf`, `file_2.pdf`). Duplikat & installer lama dipindahkan ke `_AI_Karantina` (tanpa `fs.unlink`).
4. **Prompt Injection Guard:** Ekstraksi teks dokumen dibatasi maksimal **400 karakter pertama**, dinetralisir dari breakout tag, dan dibungkus dalam `<DOCUMENT_DATA>...</DOCUMENT_DATA>`.
5. **Dry-Run Default & SHA-256 Rollback:** Setiap operasi menghasilkan *Execution Plan* preview, mencatat hash SHA-256 ke `./logs/history.json`, dan mendukung `rollback <transactionId>` dengan verifikasi integritas hash.

## Optimasi RAM & CPU
- **CPU-Only:** Maksimal 4 thread (`threads: 4`, `gpu: false`, `gpuLayers: 0`).
- **On-Demand Model Loading:** Model hanya dimuat ke RAM saat memproses tugas AI dan langsung di-*dispose/unload* di blok `finally` agar RAM kembali ke ~0 MB saat idle.

## Instalasi & Menjalankan
```bash
npm install
npm run typecheck
npm test
npm run dev
```
