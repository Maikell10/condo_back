const fs = require("fs");
const path = require("path");
const { importComplexData } = require("../src/controllers/building.controller");

const csvPath = path.join(__dirname, "..", "istmo-import-complex-data.csv");

const req = {
    file: {
        buffer: fs.readFileSync(csvPath),
    },
};

const res = {
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        console.log(`STATUS ${this.statusCode || 200}`);
        console.log(JSON.stringify(payload, null, 2));
        process.exit(this.statusCode && this.statusCode >= 400 ? 1 : 0);
    },
};

importComplexData(req, res).catch((error) => {
    console.error("IMPORT_ERROR", error.message);
    process.exit(1);
});
