import OpenAIApi from 'openai';
import fs from 'fs-extra';
import path from 'path';
import pdf from 'pdf-poppler';
import { PDFDocument } from 'pdf-lib';

const openai = new OpenAIApi({
    apiKey: ""
});
async function deleteImages(imagePaths) {
    for (const imagePath of imagePaths) {
        try {
            await fs.unlink(imagePath);
            console.log(`Deleted image: ${imagePath}`);
        } catch (error) {
            console.error(`Error deleting image ${imagePath}: `, error);
        }
    }
}
function extractJsonFromResponse(response) {
    try {
        // Extract the JSON string from the response
        const jsonString = response.message.content.match(/```json\n([\s\S]*?)\n```/)[1];
        // Parse the JSON string
        const jsonData = JSON.parse(jsonString);
        return jsonData;
    } catch (error) {
        console.error("Error parsing JSON from response: ", error);
        return null;
    }
}
function encodeImage(imagePath) {
    const image = fs.readFileSync(imagePath);
    return Buffer.from(image).toString('base64');
}

async function analyzeImages(imagePaths) {
    const contentArray = imagePaths.map(imagePath => {
        const base64Image = encodeImage(imagePath);
        return {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${base64Image}` }
        };
    });

    console.log(contentArray.length)

    const response = await openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        max_tokens: 2000,
        messages: [
            {
                role: "user",
                content: [
                    { 
                        type: "text", 
                        text: "First: Reply with as much detail as possible. Instructions: Each image was a single page from one pdf, I want you to organize the images logically so I can create new pdfs from them. Just return your answer as json in the order I sent them. so if there's only one type of document just put all of them in one document entry if there are more return more accordingly. If I send 9 images and images 1-5 are part of a contract and image 6 is something else, and image 7 is part of the contract. Keep in mind the total amount of pages and the amount of images I send. If I send 9 images it should only go up to image9. Stick to this format (just an example): {\"documents\":[{\"title\":\"Employment Contract\",\"pages\":[\"image1\",\"image2\",\"image4\",\"image5\",\"image6\",\"image7\",\"image8\",\"image9\",\"image10\"]},{\"title\":\"Course Schedule\",\"pages\":[\"image3\"]}]}" 
                    }  ,
                    ...contentArray
                ]
            }
        ]
    });

    return response.choices[0]
}
async function convertPdfToImages(file) {
    let opts = {
        format: 'jpg',  
        out_dir: path.dirname(file),
        out_prefix: path.basename(file, path.extname(file)),
        page: null
    };

    await pdf.convert(file, opts);
    const info = await pdf.info(file);
    const imagePaths = [];
    for (let i = 1; i <= info.pages; i++) {
        const imagePath = path.resolve(opts.out_dir, `${opts.out_prefix}-${i}.jpg`);
        //console.log(`Generated image path: ${imagePath}`);
        imagePaths.push(imagePath);
    }
    return imagePaths;
}


async function processPdf(pdfPath) {
    const imagePaths = await convertPdfToImages(pdfPath);
    const analyses = await analyzeImages(imagePaths);
    const parsedData = extractJsonFromResponse(analyses);
    console.log(JSON.stringify(parsedData, null, 2));

    const originalPdfBytes = await fs.readFile(pdfPath);
    const originalPdfDoc = await PDFDocument.load(originalPdfBytes);
    //console.log(`Total pages in original PDF: ${originalPdfDoc.getPageCount()}`);

    for (const doc of parsedData.documents) {
        const newPdfDoc = await PDFDocument.create();

        for (const page of doc.pages) {
            const pageIndex = parseInt(page.replace('image', '')) - 1; 
            const [copiedPage] = await newPdfDoc.copyPages(originalPdfDoc, [pageIndex]);
            newPdfDoc.addPage(copiedPage);
        }

        const pdfBytes = await newPdfDoc.save();
        await fs.writeFile(`./${doc.title}.pdf`, pdfBytes);
    }

    await deleteImages(imagePaths);

}

processPdf("./test4.pdf");
