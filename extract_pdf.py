import sys
import PyPDF2

def extract_text(pdf_path):
    try:
        reader = PyPDF2.PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        with open("pdf_content.txt", "w", encoding="utf-8") as f:
            f.write(text)
        print("Successfully extracted to pdf_content.txt")
    except Exception as e:
        print(f"Error reading PDF: {e}")

if __name__ == "__main__":
    extract_text("content (1).pdf")
