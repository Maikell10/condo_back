const pool = require("../db.js");
const moment = require("moment");
const puppeteer = require("puppeteer");
const jsdom = require("jsdom");

const setTasaBCV = async (req, res) => {
    let mostrar = [];
    try {
        // Abrimos una instancia del puppeteer y accedemos a la url de google
        const browser = await puppeteer.launch({
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-infobars",
                "--window-position=0,0",
                "--ignore-certifcate-errors",
                "--ignore-certifcate-errors-spki-list",
                '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3312.0 Safari/537.36"',
            ],
        });
        const page = await browser.newPage();
        const response = await page.goto(
            "https://www.bcv.org.ve/bcv/mision-y-vision",
            {
                waitUntil: "load",
            },
        );
        const body = await response.text();

        // Creamos una instancia del resultado devuelto por puppeter para parsearlo con jsdom
        const {
            window: { document },
        } = new jsdom.JSDOM(body);

        // Seleccionamos el dolar
        document
            .querySelectorAll("#dolar > .field-content > div > div > strong")
            .forEach((element) => mostrar.push(element.textContent));

        // Seleccionamos la fecha
        const fec = document.body
            .querySelector(".view-content > div > .pull-right > span")
            .getAttribute("content");

        //Cerramos el puppeteer
        await browser.close();

        console.log(mostrar[0]);
        return;

        // busco si hay la tasa en la BD
        const [result] = await pool.query(
            "SELECT * FROM tasas_bcv where fecha = '" +
                moment(fec).format("YYYY-MM-DD") +
                "'",
        );
        if (result.length === 0) {
            const [result] = await pool.query(
                "INSERT INTO tasas_bcv (tasa, fecha) VALUES (" +
                    mostrar[0].trim().replace(",", ".") +
                    ", '" +
                    moment(fec).format("YYYY-MM-DD") +
                    "')",
            );

            if (result.affectedRows === 0) {
                console.log("ERROR");
                sendSmsErrorTasa();
            }

            // res.status(200).send({
            //     message: mostrar[0].trim().replace(",", "."),
            //     fecha: moment(fec).format("YYYY-MM-DD"),
            // });
        } else {
            // res.status(200).send({
            //     message: "No hay nada q subir",
            // });
        }
    } catch (error) {
        console.log(error);
        sendSmsErrorTasa();
        // res.status(500).send({ message: "Error", error });
    }
};

//setTasaBCV();

module.exports = {
    setTasaBCV,
};
