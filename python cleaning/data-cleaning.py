import pandas as pd
import json
import os
from collections import defaultdict

# Get the current script's directory
script_dir = os.path.dirname(os.path.abspath(__file__))
csv_path = os.path.join(script_dir, 'Digest Survey - Sheet1.csv')

print(f"Looking for CSV file at: {csv_path}")

# Read the CSV file
df_sheet1 = pd.read_csv(csv_path)

print(f"Successfully read CSV with {len(df_sheet1)} rows")
print(f"CSV columns: {df_sheet1.columns.tolist()}")

# Dictionary to store structured data by questions
structured_data = defaultdict(lambda: {
    "Topic": None,
    "Survey Name": None,
    "Sample Size": None,
    "Responses": []
})

# Variables to track the current topic, survey name, and sample size
current_topic = None
current_survey = None
current_sample_size = None
current_question = None

for _, row in df_sheet1.iterrows():
    # Skip rows where all relevant fields are empty
    if pd.isna(row["Topic"]) and pd.isna(row["Question"]) and pd.isna(row["Response Option"]):
        continue
        
    # Update metadata when a new topic appears
    if pd.notna(row["Topic"]):
        current_topic = row["Topic"].strip()
        current_survey = row["Survey Name (Date)"].strip()
        current_sample_size = int(row["Sample Size"]) if pd.notna(row["Sample Size"]) else None

    # Process questions and responses
    if pd.notna(row["Question"]):
        current_question = row["Question"].strip()
        structured_data[current_question]["Topic"] = current_topic
        structured_data[current_question]["Survey Name"] = current_survey
        structured_data[current_question]["Sample Size"] = current_sample_size

    # Add responses under the current question
    if pd.notna(row["Response Option"]):
        # Convert percentage string to float (remove % sign and convert)
        percentage = float(row["Percentage"].strip('%')) if pd.notna(row["Percentage"]) else None
        
        response = {
            "Option": row["Response Option"].strip(),
            "Percentage": percentage,
            "Confidence": True if pd.notna(row["Confidence"]) and row["Confidence"].strip().lower() == 'yes' else False
        }
        structured_data[current_question]["Responses"].append(response)

print(f"Processed data for {len(structured_data)} questions")

# Create output file path in the same directory as the script
output_path = os.path.join(script_dir, 'clean_survey_data.json')
print(f"Saving JSON to: {output_path}")

# Save to JSON file
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(structured_data, f, indent=4, ensure_ascii=False)

print("Data processing complete!")
