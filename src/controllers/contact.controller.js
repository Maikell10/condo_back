const nodemailer = require("nodemailer");

const sendContactEmail = async (req, res) => {
    const { name, condo, email, message } = req.body;

    try {
        // 1. Configurar el transportador (Usa el correo desde el que quieres enviar)
        // Ejemplo con Gmail (Recuerda que debes crear una "Contraseña de Aplicación" en la seguridad de Google)
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: "condominioaunclic@gmail.com", // Tu correo
                pass: "tu_contraseña_de_aplicacion_aqui", // NO la contraseña normal, sino la de aplicación
            },
        });

        // 2. Armar el correo que vas a recibir tú
        const mailOptions = {
            from: "condominioaunclic@gmail.com", // Remitente (tu servidor)
            to: "condominioaunclic@gmail.com", // Destinatario (tú mismo, para leer el mensaje)
            replyTo: email, // Si le das a "Responder", le llegará al cliente
            subject: `Nuevo Lead - Condominio A Un Clic: ${condo}`,
            html: `
                <div style="font-family: sans-serif; color: #333;">
                    <h2>¡Alguien quiere contratar Condominio A Un Clic! 🚀</h2>
                    <p><strong>Nombre:</strong> ${name}</p>
                    <p><strong>Edificio/Condominio:</strong> ${condo}</p>
                    <p><strong>Correo del cliente:</strong> ${email}</p>
                    <br/>
                    <p><strong>Mensaje:</strong></p>
                    <p style="padding: 15px; background: #f4f4f5; border-radius: 8px;">${message}</p>
                </div>
            `,
        };

        // 3. Enviar el correo
        await transporter.sendMail(mailOptions);

        res.status(200).json({ message: "Correo enviado con éxito" });
    } catch (error) {
        console.error("Error al enviar el correo:", error);
        res.status(500).json({ message: "Error interno al enviar correo." });
    }
};

module.exports = { sendContactEmail };
