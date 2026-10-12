use tauri::{
    menu::{Menu, MenuBuilder, MenuItem, SubmenuBuilder},
    AppHandle,
};

pub fn build(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let quit = MenuItem::with_id(
        app,
        "request-quit",
        "Quit box.md",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let app_menu = SubmenuBuilder::new(app, "box.md")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .separator()
        .item(&quit)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .close_window()
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &window])
        .build()
}
