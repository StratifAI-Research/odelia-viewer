# Use Python 3.10+ for transformers compatibility
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the app code
COPY app.py .
COPY model_loader.py .
COPY dicom_utils.py .

# Create directories for model and images
RUN mkdir -p /app/mst_model /app/images

# Expose the port Flask runs on
EXPOSE 5556

# Run the Flask app (model will be downloaded on first start)
CMD ["python", "app.py"]
