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
    contactLabels: { "Date of Joining": "joiningDate", "Email ID (Official)": "officialEmail" },
    /** Read-only: we only read the selected option, never change it. */
    statusSelect: "select.employee_status",
    documentsSection: "#document_info",
    docStatusPattern: /^(verified|pending|rejected|not verified)$/i,
  },

  /** Uploaded files live on a second host. Folder name in the URL → document kind (observed 2026-11-01). */
  documents: {
    hosts: ["resourcedata.in"],
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
    } as Record<string, string>,
  },

  /** Read-only guard: anything that could change data, end the session, or send mail. */
  deniedPathPattern:
    /logout|log-out|signout|delete|remove|destroy|approve|reject|update|edit|modify|status|upload|download|export|send|mail|form16|change-password|payment|invoice|save|store|create|attendance-approval|verify/i,
  allowedPostPaths: [/^\/get_employee_list$/],
  allowedDocumentPaths: [/^\/$/, /^\/user-login\/?$/, /^\/dashboard\/?$/, /^\/employee-records\/?$/, /^\/employee-profile\/E\d{1,10}$/],
} as const;
