/**
 * MahaHRD-specific facts. Every value here was observed on the live site
 * (read-only inspection, 2026-10-31) — nothing is guessed. If the site changes,
 * the drift check in listing.ts fails fast instead of storing bad data.
 */
export const MAHAHRD = {
  paths: {
    listing: "/employee-records",
    listingEndpoint: "/get_employee_list", // POST, server-side DataTables, read-only
    profile: (code: string) => `/employee-profile/${encodeURIComponent(code)}`,
  },

  listing: {
    table: "#employeeTable",
    /** DataTables column data keys, in order (null = Sr. No. / View columns). */
    expectedColumns: [null, "emp_photo", "fullname", "dept_head_name", "sub_project_name", "approved_ctc", "district_name", null],
    expectedHeaders: ["Sr. No.", "Photo", "Name", "Department/Project", "Sub-Project/Designation", "Approved CTC", "Location", "View"],
    /** Keys the JSON rows must contain for our mapping to be valid. */
    requiredRowKeys: ["emp_profile_id", "fullname", "dept_head_name", "sub_project_name", "role_name", "district_name"],
    /** Filters we support: our name → <select id> on the page → request param. Values are numeric ids, "" = All (observed). */
    filters: {
      district: { selectId: "district", param: "district" },
      departmentHead: { selectId: "dept_head", param: "dept_head" },
    },
    pageSize: 100,
  },

  /** JSON row key → our field. Keys NOT listed here (Aadhaar, salary, personal email…) are never read. */
  listingFieldMap: {
    emp_profile_id: "sourceEmployeeCode",
    fullname: "fullName",
    gender: "gender",
    type_of_employee: "employeeType",
    dept_head_name: "departmentHead",
    dept_name: "department",
    sub_project_name: "subProject",
    role_name: "designation",
    district_name: "district",
    mobile_no: "mobile", // approval-gated: dropped by the allow-list unless approved
  },

  profile: {
    /** `<p>Label</p><h5>Value</h5>` blocks */
    detailBlock: "#profile_info .profile_detail",
    detailLabels: { Taluka: "taluka" },
    /** `<span.contact-label>Label</span> : <span.contact-value>Value</span>` */
    contactItem: ".contact-item",
    contactLabels: { "Employee ID": "officialEmployeeId", "Date of Joining": "joiningDate", "Email ID (Official)": "officialEmail" },
    /** Read-only: we only read the selected option, never change it. */
    statusSelect: "select.employee_status",
    documentsSection: "#document_info",
    docStatusPattern: /^(verified|pending|rejected|not verified)$/i,

    /**
     * "Profile & employment" details (approved group). Every tab is server-rendered into the
     * same page as `.profile_detail` rows of `<p.mb-2>Label</p><h5.mb-0>Value</h5>` (observed
     * 2026-11-01 on E8790 / E3559 / E8825). ONLY the labels below are read; anything else in
     * those tabs (religion, caste, Aadhaar, PAN, salary, EPFO, bank…) is never touched.
     */
    personal: {
      emptyValue: /^(not provided|n\/a|na|-|—|no record found)$/i,
      profile: {
        pane: "#profile_info",
        labels: {
          "Father's / Husband's Name": "fatherOrHusbandName",
          "Date of Birth": "dateOfBirth",
          Address: "address",
          Pincode: "pincode",
          "Alternate Contact No.": "alternateContact",
          "Blood Group": "bloodGroup",
          "Marital Status": "maritalStatus",
          "Emergency Contact Name & Relation": "emergencyContactName",
          "Emergency Contact No.": "emergencyContactNo",
        },
      },
      education: {
        pane: "#education_info",
        labels: { Qualification: "qualification", "Education Name": "qualification", "Board / University Name": "board", "Year of Passing": "yearOfPassing", "Marks Obtained": "marks", Marks: "marks" },
      },
      employment: {
        pane: "#employment_info",
        labels: {
          "Previous Employer": "employer",
          Designation: "designation",
          "Duration (From Date)": "fromDate",
          "Duration (To Date)": "toDate",
          "Reason for Leaving": "reasonForLeaving",
          "Experience Letter Submitted": "experienceLetterSubmitted",
          "Did the Previous Employer Process the Exit?": "exitProcessed",
        },
      },
      domicile: {
        pane: "#domicile_info",
        labels: {
          "Place of Birth": "placeOfBirth",
          "Native District": "nativeDistrict",
          "Permanent Address": "permanentAddress",
          "Permanent Address Duration of Stay": "durationOfStay",
          "School / Education History in State": "schoolingInState",
          "School Name & Location": "schoolNameLocation",
          "Mother Tongue": "motherTongue",
        },
      },
      nominee: {
        pane: "#nominee_info",
        labels: { Name: "name", Relationship: "relationship", "DOB & Age": "dateOfBirth", "Mobile No.": "mobile" },
      },
      /** Header card: `<span.contact-label>Reporting Officer</span><span.contact-value>name<br>designation<br>district<br>phone</span>` */
      reportingOfficerLabel: "Reporting Officer",
    },

    /**
     * Sensitive groups (Phase 10, approved 2026-11-01). Same `<p.mb-2>Label</p><h5>Value</h5>` markup,
     * observed on E8790. Only these labels are read. NEVER read: portal username/password, the full
     * Aadhaar number (last 4 kept), PF nominee's Aadhaar, mother's maiden name.
     */
    sensitive: {
      contact: { "WhatsApp No.": "whatsapp", "Email ID (Personal)": "personalEmail" },
      identityProfile: {
        pane: "#profile_info",
        labels: { "Aadhaar Card No.": "aadhaar", "Name as on Aadhaar Card": "aadhaarName", "PAN Card No.": "pan", "Name as on PAN Card": "panName", "Father's Name as on PAN Card": "panFatherName" },
      },
      /** `#document_info .border > header.doc_header > p (label) + h6 (number)`, then `p.text-mute` "Name as on X - NAME". */
      identityDocs: { pane: "#document_info", header: "header.doc_header", nameLine: "p.text-mute", skip: ["Aadhaar Card", "PAN Card"] },
      bank: {
        pane: "#bank_info",
        labels: { Bank: "bank", Branch: "branch", "Name of Account Holder": "accountHolder", "Account No.": "accountNumber", "IFSC Code": "ifsc", "UPI ID(Optional)": "upi" },
      },
      epfo: {
        pane: "#epfo_info",
        labels: {
          "UAN (Universal Account No.)": "uan",
          "Previous PF No. (If Any)": "previousPfNo",
          "Previous Employer Name": "previousEmployer",
          "PF Exit Date (From Last Employer)": "pfExitDate",
          "PF Nominee Name": "pfNomineeName",
          "PF Nominee Aadhaar / DOB": "pfNomineeAadhaarDob",
          "Nominee Relationship": "nomineeRelationship",
          "PF % Deduction Choice (Std. / Higher)": "pfDeductionChoice",
          "Already Covered Under ESIC?": "esicCovered",
          "ESIC IP No. (If Existing)": "esicIpNo",
          "Previous Employer ESIC Code": "previousEsicCode",
        },
      },
      /** "Additional Details of Employee" = first `.row` of #settings_info. */
      family: {
        pane: "#settings_info",
        labels: {
          "Father's Name": "fatherName", "Father's DOB": "fatherDob", "Father's Occupation": "fatherOccupation",
          "Mother's Name": "motherName", "Mother's DOB": "motherDob", "Mother's Occupation": "motherOccupation",
          "Spouse Name": "spouseName", "Spouse Occupation": "spouseOccupation", "No. of Children": "childrenCount", "No. of Dependant Person": "dependants",
        },
        child: { "Child Name": "name", "Date of Birth": "dob", Occupation: "occupation" },
      },
      category: {
        profile: { Religion: "religion", Category: "category", "Sub-Caste": "subCaste" },
        settings: { Religion: "religion", Caste: "caste", "Sub-Caste": "subCaste", "Physically Disability": "disability" },
        domicile: { Caste: "caste", "Caste Certificate Issued By": "casteCertificateIssuedBy" },
      },
      /** Previous employers' salary: #employment_info "Last Salary" and #settings_info "Monthly Salary" rows. */
      salary: { employerLabel: "Previous Employer", salaryLabels: ["Last Salary", "Monthly Salary"], panes: ["#employment_info", "#settings_info"] },
      /** `#office_info` map caption: `<b>Latitude:</b> 12.34<br><b>Longitude:</b> 56.78` */
      office: { pane: "#office_info" },
    },
  },

  /** Uploaded files live on a second host. Folder name in the URL → document kind (observed 2026-11-01). */
  documents: {
    // All uploaded files are served from resourcedata.in (GET only).
    hosts: ["resourcedata.in"],
    /**
     * The profile links experience letters as mahahrd.com/user_data_uploads/…, but those links answer
     * 404 at the source itself; the same path on resourcedata.in serves the file (verified 2026-11-01).
     */
    rehost: { "mahahrd.com": "resourcedata.in" } as Record<string, string>,
    pathPrefix: "/user_data_uploads/",
    placeholder: /no_document_dummy/i,
    folderKinds: {
      profile_photos: "PROFILE_PHOTO",
      ssc_certificate_photo: "SSC_CERTIFICATE",
      hsc_certificate_photo: "HSC_CERTIFICATE",
      other_certificates: "OTHER_CERTIFICATE",
      aadhaar_front_photo: "AADHAAR_FRONT",
      aadhaar_back_photo: "AADHAAR_BACK",
      pan_card_photo: "PAN",
      bank_passbook_photo: "BANK_PASSBOOK",
      resume: "RESUME",
      a_form: "A_FORM",
      voter_id_photo: "VOTER_ID",
      experience_letters: "EXPERIENCE_LETTER",
      graduation: "GRADUATION_CERTIFICATE", // education-tab upload folders (seen 2026-11-03)
      pg: "POSTGRADUATION_CERTIFICATE",
    } as Record<string, string>,
    /**
     * The employee's photo is the avatar on the profile card. The top bar also shows a photo from the
     * same profile_photos folder — the SIGNED-IN ADMIN's own avatar — which must never be taken.
     */
    employeePhoto: ".profile_card img.cardprofile_avatar",
    ignoreImagesIn: "#page-topbar, .navbar-header, .header-profile-user",
    /** Identity tab blocks are mapped by their label (folder names of unseen uploads are unknown). */
    identityLabelKinds: {
      "Aadhaar Card": null, // front/back come from their folders
      "PAN Card": "PAN",
      "Voter ID": "VOTER_ID",
      Passport: "PASSPORT",
      "Driving License": "DRIVING_LICENCE",
      "Ration Card": "RATION_CARD",
      "Residence Proof": "RESIDENCE_PROOF",
    } as Record<string, string | null>,
  },

  /** Read-only guard: anything that could change data, end the session, or send mail. */
  deniedPathPattern:
    /logout|log-out|signout|delete|remove|destroy|approve|reject|update|edit|modify|status|upload|download|export|send|mail|form16|change-password|payment|invoice|save|store|create|attendance-approval|verify/i,
  // Read-only data endpoints the profile page itself calls (verified 2026-11-01: they return JSON and change nothing).
  allowedPostPaths: [/^\/get_employee_list$/, /^\/get_attendance$/, /^\/get_tickets$/],
  allowedDocumentPaths: [/^\/$/, /^\/user-login\/?$/, /^\/dashboard\/?$/, /^\/employee-records\/?$/, /^\/employee-profile\/E\d{1,10}$/],
} as const;
