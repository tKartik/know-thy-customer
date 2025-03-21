import pandas as pd
import json
import os
from collections import defaultdict
import re

# Get the current script's directory
script_dir = os.path.dirname(os.path.abspath(__file__))

# Look for the Excel file in multiple possible locations
possible_excel_paths = [
    os.path.join(script_dir, 'Digest Survey (1).xlsx'),
    os.path.join(os.path.dirname(script_dir), 'cleaning', 'Digest Survey (1).xlsx'),
    os.path.join(os.path.dirname(script_dir), 'python cleaning', 'Digest Survey (1).xlsx')
]

excel_path = None
for path in possible_excel_paths:
    if os.path.exists(path):
        excel_path = path
        break

if not excel_path:
    raise FileNotFoundError(f"Excel file not found in any of the expected locations: {possible_excel_paths}")

print(f"Looking for Excel file at: {excel_path}")

# Read the Excel file
df_sheet1 = pd.read_excel(excel_path)

print(f"Successfully read Excel with {len(df_sheet1)} rows")
print(f"Excel columns: {df_sheet1.columns.tolist()}")

# Dictionary to store structured data by unique question identifiers
structured_data = {}

# Variables to track the current topic, survey name, and sample size
current_topic = None
current_survey = None
current_sample_size = None
current_question = None
current_question_id = None

# Counter for tracking unique questions
question_counter = 0
row_counter = 0
response_counter = 0

# Dictionary to track questions with the same text
question_text_counter = {}

# Track previous rows for debugging
prev_question_id = None

for idx, row in df_sheet1.iterrows():
    row_counter += 1
    
    # Skip rows where all relevant fields are empty
    if pd.isna(row["Topic"]) and pd.isna(row["Question"]) and pd.isna(row["Response Option"]) and pd.isna(row["Percentage"]):
        continue
        
    # Update metadata when a new topic appears
    if pd.notna(row["Topic"]):
        current_topic = str(row["Topic"]).strip() if not isinstance(row["Topic"], str) else row["Topic"].strip()
        current_survey = str(row["Survey Name (Date)"]).strip() if pd.notna(row["Survey Name (Date)"]) and not isinstance(row["Survey Name (Date)"], str) else row["Survey Name (Date)"].strip() if pd.notna(row["Survey Name (Date)"]) else ""
        
        # Handle sample size with commas and text like '1,198 responses'
        if pd.notna(row["Sample Size"]):
            try:
                # Convert to string first
                sample_size_str = str(row["Sample Size"])
                # Extract numbers only
                numbers_only = re.sub(r'[^0-9]', '', sample_size_str)
                current_sample_size = int(numbers_only) if numbers_only else None
            except (ValueError, TypeError):
                current_sample_size = None
        else:
            current_sample_size = None
            
        print(f"Found topic: {current_topic}, Survey: {current_survey}")

    # Process questions and responses
    if pd.notna(row["Question"]):
        current_question = str(row["Question"]).strip() if not isinstance(row["Question"], str) else row["Question"].strip()
        
        # Check if we've seen this question text before
        # If we have, increment the counter
        if current_question in question_text_counter:
            question_text_counter[current_question] += 1
        else:
            question_text_counter[current_question] = 1
        
        # Create a unique identifier - for duplicates, add extra spaces at the end
        if question_text_counter[current_question] > 1:
            # Add n-1 spaces at the end (where n is the occurrence number)
            extra_spaces = " " * (question_text_counter[current_question] - 1)
            current_question_id = f"{current_question}{extra_spaces}"
        else:
            current_question_id = current_question
        
        if prev_question_id != current_question_id:
            question_counter += 1
            print(f"Question {question_counter}: '{current_question}' (ID: {current_question_id})")
            prev_question_id = current_question_id
        
        # Initialize the question data structure if it doesn't exist
        if current_question_id not in structured_data:
            structured_data[current_question_id] = {
                "Topic": current_topic,
                "Survey Name": current_survey,
                "Sample Size": current_sample_size,
                "Question Text": current_question,
                "Responses": []
            }

    # Add responses with non-zero percentages under the current question
    if current_question_id is not None and pd.notna(row["Percentage"]):
        try:
            # Convert percentage string to float (remove % sign and convert)
            if isinstance(row["Percentage"], str):
                percentage = float(row["Percentage"].strip('%'))
                # If the value had a % sign, it's already in percentage form (0-100)
            else:
                percentage = float(row["Percentage"])
                # If the value was not a string (was already a number), ensure it's in percentage form (0-100)
                if percentage <= 1:
                    percentage = percentage * 100
            
            # Include the response if percentage is non-zero
            if percentage > 0:
                response_text = str(row["Response Option"]).strip() if pd.notna(row["Response Option"]) and not isinstance(row["Response Option"], str) else row["Response Option"].strip() if pd.notna(row["Response Option"]) else "Unlabeled Response"
                response = {
                    "Option": response_text,
                    "Percentage": percentage
                    # Removed Confidence field as requested
                }
                structured_data[current_question_id]["Responses"].append(response)
                response_counter += 1
        except (ValueError, TypeError) as e:
            print(f"Warning: Could not convert percentage value '{row['Percentage']}' to float for question '{current_question}', response '{row.get('Response Option', 'Unlabeled')}'")
            print(f"Error: {e}")

print(f"Processed {row_counter} rows")
print(f"Found {question_counter} unique questions")
print(f"Captured {response_counter} responses with non-zero percentages")
print(f"Final dictionary contains {len(structured_data)} question entries")

# Create output file path in the same directory as the script
output_path = os.path.join(script_dir, 'clean_survey_data.json')
print(f"Saving JSON to: {output_path}")

# Save to JSON file
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(structured_data, f, indent=4, ensure_ascii=False)

print("Data processing complete!") 