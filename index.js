/** Host half of dsh-file-link.
 *
 * Everything the plugin does routes through services the Harness already
 * owns: the Client calls `remote.session.openWorkspacePath` to hand a path to
 * the desktop, and `sidebarRight.openResource` to preview it in the side
 * panel. The Host therefore has nothing of its own to register; the apply
 * body exists so the row is a valid plugin entry.
 */
export function apply() {}
