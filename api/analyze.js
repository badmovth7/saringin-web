module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY belum dipasang di Vercel.' });
  }

  try {
    const { type, text, imageBase64, mimeType, elaScore, lang } = req.body;
    const isID = lang === 'id';

    const systemInstruction = `
Kamu adalah mesin forensik digital dan pemeriksa fakta profesional untuk aplikasi "SaringIn".
Tugasmu adalah menganalisis gambar/screenshot atau teks berita untuk mendeteksi hoaks, editan "timpaan", manipulasi AI, atau misinformasi.

ATURAN ANALISIS PENTING:
1. Jika ada GAMBAR + CAPTION/KONTEKS: Cek kecocokan visual dengan klaim caption! Jika objek di gambar tidak masuk akal, berupa stiker/kartun tempelan, parodi, atau bertentangan dengan caption, langsung beri skor RENDAH (10-35) dan status "MANIPULATED".
2. Jika gambar terlihat seperti dokumentasi berita asli (misal: ada watermark media kredibel, pencahayaan & proporsi wajar, sesuai konteks), beri skor TINGGI (75-95) dan status "CREDIBLE".
3. Jawab seluruh isi teks dalam bahasa: ${isID ? 'Bahasa Indonesia' : 'English'}.

WAJIB kembalikan HANYA JSON valid dengan struktur persis seperti ini:
{
  "score": 50,
  "status": "CREDIBLE | VERIFY | MANIPULATED",
  "headline": "judul status singkat maks 4 kata",
  "summary": "ringkasan analisis 2-3 kalimat yang jelas dan konkret",
  "metrics": {
    "integrity": 50,
    "source": 50,
    "consistency": 50
  },
  "findings": [
    { "title": "judul temuan 1", "detail": "penjelasan singkat", "level": "high | medium | low" },
    { "title": "judul temuan 2", "detail": "penjelasan singkat", "level": "high | medium | low" },
    { "title": "judul temuan 3", "detail": "penjelasan singkat", "level": "high | medium | low" },
    { "title": "judul temuan 4", "detail": "penjelasan singkat", "level": "high | medium | low" }
  ]
}`;

    const isImage = type === 'image' && imageBase64;
    const userContent = isImage
      ? [
          {
            type: 'text',
            text: `Analisis gambar ini.\nCaption/Konteks dari pengguna: "${text || '(tidak ada caption)'}"\nSkor ELA dari browser: ${elaScore ?? 'N/A'}/100.`
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`
            }
          }
        ]
      : `Analisis kredibilitas teks/pesan berikut:\n"""\n${text}\n"""`;

    const models = isImage
      ? ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct']
      : ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct'];

    let data = null;
    let lastError = 'Gagal menghubungi server Groq.';

    for (const model of models) {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userContent }
          ]
        })
      });

      const tempData = await response.json();
      if (response.ok) {
        data = tempData;
        break;
      }
      lastError = tempData.error?.message || `Error di model ${model}`;
    }

    if (!data) {
      return res.status(503).json({ error: lastError });
    }

    const rawText = data.choices?.[0]?.message?.content;
    const parsedResult = JSON.parse(rawText);

    return res.status(200).json(parsedResult);
  } catch (err) {
    return res.status(500).json({ error: 'Gagal memproses analisis: ' + err.message });
  }
};
