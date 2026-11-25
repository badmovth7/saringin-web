module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY belum dipasang di Vercel.' });
  }

  try {
    const { type, text, imageBase64, mimeType, elaScore, lang } = req.body;
    const isID = lang === 'id';

    const systemInstruction = `
Kamu adalah mesin forensik digital dan pemeriksa fakta profesional untuk aplikasi "SaringIn".
Tugasmu adalah menganalisis gambar/screenshot atau teks berita untuk mendeteksi hoaks, editan "timpaan", manipulasi AI, atau parodi/meme yang menyesatkan.

ATURAN ANALISIS PENTING:
1. Jika ada GAMBAR + CAPTION/KONTEKS: Cek kecocokan visual dengan klaim caption! Jika objek di gambar tidak masuk akal, berupa stiker/kartun/tempelan, atau bertolak belakang dengan klaim teks, berikan skor kredibilitas RENDAH (< 40) meskipun skor ELA terlihat normal (karena kompresi ulang medsos sering meratakan ELA).
2. Jika gambar terlihat seperti dokumentasi berita asli (misal: ada watermark media kredibel, pencahayaan & proporsi wajar, konsisten dengan caption), berikan skor TINGGI (> 75).
3. Jawab seluruh isi teks dalam bahasa: ${isID ? 'Bahasa Indonesia' : 'English'}.

WAJIB kembalikan HANYA JSON valid dengan struktur persis seperti ini:
{
  "score": <angka 0-100, semakin tinggi semakin kredibel>,
  "status": "<'CREDIBLE' | 'VERIFY' | 'MANIPULATED'>",
  "headline": "<judul status singkat, maks 4 kata>",
  "summary": "<ringkasan analisis 2-3 kalimat yang jelas dan konkret>",
  "metrics": {
    "integrity": <angka 0-100>,
    "source": <angka 0-100>,
    "consistency": <angka 0-100>
  },
  "findings": [
    { "title": "<judul temuan 1>", "detail": "<penjelasan singkat>", "level": "<'high' | 'medium' | 'low'>" },
    { "title": "<judul temuan 2>", "detail": "<penjelasan singkat>", "level": "<'high' | 'medium' | 'low'>" },
    { "title": "<judul temuan 3>", "detail": "<penjelasan singkat>", "level": "<'high' | 'medium' | 'low'>" },
    { "title": "<judul temuan 4>", "detail": "<penjelasan singkat>", "level": "<'high' | 'medium' | 'low'>" }
  ]
}`;

    const parts = [{ text: systemInstruction }];

    if (type === 'image' && imageBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: imageBase64
        }
      });
      parts.push({
        text: `Analisis gambar ini.\nCaption/Konteks dari pengguna: "${text || '(tidak ada caption)'}"\nSkor ELA dari browser: ${elaScore ?? 'N/A'}/100.`
      });
    } else {
      parts.push({
        text: `Analisis kredibilitas teks/pesan berikut:\n"""\n${text}\n"""`
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Gemini API error' });
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsedResult = JSON.parse(rawText);

    return res.status(200).json(parsedResult);
  } catch (err) {
    return res.status(500).json({ error: 'Gagal memproses analisis: ' + err.message });
  }
};