module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, text, imageBase64, mimeType, elaScore, lang } = req.body;
    const isID = lang === 'id';
    const isImage = type === 'image' && imageBase64;

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

    let rawText = '';

    if (isImage) {
      const promptText = `Analisis gambar ini.\nCaption/Konteks dari pengguna: "${text || '(tidak ada caption)'}"\nSkor ELA dari browser: ${elaScore ?? 'N/A'}/100.`;
      let lastError = 'Semua server AI gambar sedang sibuk.';

      // === 1. COBA GEMINI DULU ===
      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey) {
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { text: systemInstruction },
                    { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
                    { text: promptText }
                  ]
                }],
                generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
              })
            }
          );
          const geminiData = await geminiRes.json();
          if (geminiRes.ok && geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
            rawText = geminiData.candidates[0].content.parts[0].text;
          } else {
            lastError = geminiData.error?.message || 'Gemini sedang sibuk.';
          }
        } catch (e) {
          lastError = e.message;
        }
      }

      // === 2. CADANGAN OTOMATIS: OPENROUTER (VISION GRATIS) ===
      if (!rawText) {
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        if (!openRouterKey) {
          return res.status(503).json({ error: `${lastError} (OPENROUTER_API_KEY belum dipasang)` });
        }

        const fallbackModels = [
          'qwen/qwen2.5-vl-72b-instruct:free',
          'google/gemma-3-27b-it:free',
          'meta-llama/llama-3.2-11b-vision-instruct:free'
        ];

        for (const model of fallbackModels) {
          try {
            const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openRouterKey}`,
                'HTTP-Referer': 'https://saringin-web.vercel.app',
                'X-Title': 'SaringIn'
              },
              body: JSON.stringify({
                model,
                temperature: 0.2,
                messages: [
                  { role: 'system', content: systemInstruction },
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: promptText },
                      {
                        type: 'image_url',
                        image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` }
                      }
                    ]
                  }
                ]
              })
            });

            const orData = await orRes.json();
            if (orRes.ok && orData.choices?.[0]?.message?.content) {
              rawText = orData.choices[0].message.content;
              break;
            }
            lastError = orData.error?.message || `Error di ${model}`;
          } catch (e) {
            lastError = e.message;
          }
        }
      }

      if (!rawText) {
        return res.status(503).json({ error: lastError });
      }
    } else {
      // === JALUR TEKS: GROQ ===
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) return res.status(500).json({ error: 'GROQ_API_KEY belum dipasang di Vercel.' });

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: `Analisis kredibilitas teks/pesan berikut:\n"""\n${text}\n"""` }
          ]
        })
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({ error: data.error?.message || 'Groq API error' });
      }
      rawText = data.choices?.[0]?.message?.content || '';
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsedResult = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

    return res.status(200).json(parsedResult);
  } catch (err) {
    return res.status(500).json({ error: 'Gagal memproses analisis: ' + err.message });
  }
};
