#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let first = &args[1];
        let url = if first == "--open" || first == "-o" || first == "open" {
            args.get(2).cloned().unwrap_or_default()
        } else if !first.starts_with('-') {
            first.clone()
        } else {
            String::new()
        };

        if !url.is_empty() {
            let target_url = if !url.starts_with('/') && !url.starts_with("http") {
                format!("/{}", url)
            } else {
                url
            };

            if rrwr_lib::try_send_navigate_to_running(&target_url) {
                println!("[*] Navigated running RRWR instance to {}", target_url);
                return;
            }
        }
    }

    rrwr_lib::run();
}
