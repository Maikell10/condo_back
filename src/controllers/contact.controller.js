const { Resend } = require("resend");

// 🔥 Pega tu API Key aquí (idealmente ponla en tu archivo .env)
const resend = new Resend(process.env.API_KEY_RESEND);

const sendContactEmail = async (req, res) => {
    const { name, condo, email, message } = req.body;

    try {
        const { data, error } = await resend.emails.send({
            // Mientras estés en el plan gratis y no verifiques tu dominio,
            // DEBES usar este correo de prueba como remitente:
            from: "Condominio A Un Clic <onboarding@resend.dev>",

            // Y DEBES poner el correo con el que te registraste en Resend como destinatario:
            to: ["inversionesoliveira1608@gmail.com"],

            reply_to: email, // Esto hace que si le das "Responder" al correo, le escribas al cliente
            subject: `Nuevo Lead - ${condo}`,
            html: `
                <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                    <div style="background-color: #4f46e5; padding: 20px; text-align: center; color: white;">
                        <h2 style="margin: 0;">¡Nuevo Prospecto! 🚀</h2>
                    </div>
                    <div style="padding: 24px;">
                        <p style="margin-bottom: 8px;"><strong>👤 Nombre:</strong> ${name}</p>
                        <p style="margin-bottom: 8px;"><strong>🏢 Edificio/Condominio:</strong> ${condo}</p>
                        <p style="margin-bottom: 24px;"><strong>✉️ Correo:</strong> ${email}</p>
                        
                        <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
                            <p style="margin: 0; font-size: 14px; color: #475569; font-weight: bold; margin-bottom: 8px;">Mensaje del cliente:</p>
                            <p style="margin: 0; color: #1e293b; line-height: 1.5;">${message}</p>
                        </div>
                    </div>
                </div>
            `,
        });

        if (error) {
            console.error("Error desde Resend:", error);
            return res
                .status(400)
                .json({ message: "No se pudo enviar el correo." });
        }

        res.status(200).json({ message: "¡Mensaje enviado con éxito!" });
    } catch (error) {
        console.error("Excepción en el servidor:", error);
        res.status(500).json({
            message: "Error interno al enviar el mensaje.",
        });
    }
};

module.exports = { sendContactEmail };
